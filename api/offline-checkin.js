import { verifyIdToken } from './_lib/verifyAuth.js';
import { pointsAppCheckGate } from './_lib/appCheck.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { loadPlace } from './_lib/loadPlace.js';
import { userDayKey } from './_lib/streakClock.js';
import { payVerifiedCheckin, homeOf, isNearHome } from './_lib/checkinPayout.js';
import { isPro } from './_lib/entitlements.js';
import { sendPushToUser } from './_lib/push.js';
import { photoShowsPlace } from './_lib/photoCheck.js';
import { guardPhoto, isOwnPlacePhoto } from './_lib/photoGuard.js';
import { takeDailyQuota } from './_lib/usageQuota.js';
import { cleanUserName } from './_lib/leaderboardPoints.js';
import { offlineCheckinDecision, validFix, OFFLINE_FREE_PER_DAY } from '../src/lib/presence.js';
import { isRealCheckin } from '../src/lib/realCheckin.js';
import { canonicalLandmarkId } from '../src/data/regions.js';
import { POINTS_PER_CHECKIN } from '../src/lib/checkinPoints.js';
import { CHECKIN_RADIUS_ON } from '../src/lib/maprConstants.js';

// An offline check-in, synced (owner, 2026-11-24). The phone checked in with
// no internet: it kept the GPS fix, the moment and maybe a photo, and sends
// them here once it's back online (src/lib/offlineCheckins.js). The server
// creates the check-in, decides from that fix (offlineCheckinDecision in
// src/lib/presence.js) and pays only what it verified:
//   within the place's radius                      verified, paid
//   nearby (under 1 km) and the photo shows it     verified, paid
//   farther, photo or not                          saved, not verified, 0
// Free accounts: OFFLINE_FREE_PER_DAY a day (by the day it was made); Pro:
// no limit (entitlements.js). Idempotent: the phone's clientId maps to one
// check-in (offline_checkins/{uid}_{clientId}, server-only), so a retry
// after a dropped answer never makes a second one.
//
// POST { clientId, region, landmarkId, fix, capturedAtMs, photoURL? }

export const OFFLINE_RATE_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000 };
const send = (res, code, body) => res.status(code).json(body);
const validClientId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

// The next check-in id for this place, the same way the app numbers them
// (leaderboard.js claimCheckIn), and the visit number among real visits.
function nextCheckinId(uid, landmarkId, prior) {
  const base = `${uid}_${landmarkId}`;
  let maxIdx = 0;
  for (const d of prior) {
    if (d.id === base) maxIdx = Math.max(maxIdx, 1);
    else if (d.id.startsWith(`${base}_`) && /^\d+$/.test(d.id.slice(base.length + 1))) maxIdx = Math.max(maxIdx, Number(d.id.slice(base.length + 1)));
  }
  const n = Math.max(prior.length, maxIdx) + 1;
  return { checkinId: n === 1 ? base : `${base}_${n}`, visitNumber: prior.filter((d) => isRealCheckin(d.data())).length + 1 };
}

// Whether the photo shows the place: { ok } or { failed } when the check
// couldn't run (the phone tries again later).
async function photoPasses(db, { uid, landmarkId, photoURL, place }) {
  if (!photoURL || !isOwnPlacePhoto(photoURL, uid, landmarkId)) return { ok: false, why: 'no-photo' };
  const g = await guardPhoto(db, photoURL, { uid, landmarkId });
  if (!g.ok) return { ok: false, why: g.reason || 'photo-guard' };
  const q = await takeDailyQuota('ai-photo', { uid });
  if (!q.ok) return { failed: true, why: 'check-limit' };
  const verdict = await photoShowsPlace({ url: photoURL, place: { name: place.name, city: place.city || '', description: place.whatItIs || place.summary || '', images: Array.isArray(place.images) ? place.images : [] } });
  if (verdict.failed) return { failed: true, why: 'check-failed' };
  return { ok: !!verdict.ok, why: verdict.reason || '' };
}

// The notice for an offline check-in that synced and paid: an inbox row
// (notifications/, the app's list) and a push to their devices.
export const offlinePaidMessage = (name, awarded) => `Your offline check-in at ${name} synced and it's verified. +${awarded} points.`;
export async function notifyOfflinePaid(db, uid, { name, awarded, landmarkId, region }, { push = sendPushToUser } = {}) {
  const message = offlinePaidMessage(name, awarded);
  await db.collection('notifications').add({ uid, type: 'offline_checkin_paid', message, read: false, createdAt: FieldValue.serverTimestamp(), createdAtMs: Date.now(), landmarkId, ...(region ? { region } : {}) });
  await push(uid, { title: 'Check-in synced', body: message, data: { type: 'offline_checkin_paid', landmarkId, region: region || '' } }).catch(() => null);
}

export async function syncOfflineCheckin(db, uid, body, { nowMs = Date.now(), pro = isPro, photoCheck = photoPasses, pay = payVerifiedCheckin, radiusOn = CHECKIN_RADIUS_ON, notify = notifyOfflinePaid } = {}) {
  const { clientId, region, fix, capturedAtMs, photoURL = null } = body;
  const landmarkId = canonicalLandmarkId(String(body.landmarkId || ''), region);
  const doneRef = db.collection('offline_checkins').doc(`${uid}_${clientId}`);
  const done = await doneRef.get();
  if (done.exists) return { status: 200, body: { ...done.data().result, already: true } };

  const place = await loadPlace(db, region, landmarkId);
  if (!place) return { status: 200, body: { ok: true, saved: false, reason: 'no-place', awarded: 0 } };
  const day = await userDayKey(db, uid, capturedAtMs);

  // One real visit per place per day: a check-in already there that day is
  // this visit.
  const priorSnap = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
  const prior = priorSnap.docs;
  const dayOf = async (d) => userDayKey(db, uid, d.data().createdAt?.toMillis?.() ?? 0);
  for (const d of prior) {
    if (isRealCheckin(d.data()) && (await dayOf(d)) === day) {
      const result = { ok: true, saved: true, checkinId: d.id, sameDay: true, verified: d.data().presence?.verified === true, awarded: 0 };
      await doneRef.set({ uid, result, at: FieldValue.serverTimestamp() });
      return { status: 200, body: result };
    }
  }

  // Free: OFFLINE_FREE_PER_DAY a day; Pro: unlimited.
  const unlimited = await pro(db, uid);
  const dayRef = db.collection('offline_checkin_days').doc(`${uid}_${day}`);
  const used = (await dayRef.get()).data()?.count || 0;
  if (!unlimited && used >= OFFLINE_FREE_PER_DAY) {
    const result = { ok: true, saved: false, reason: 'offline-limit', limit: OFFLINE_FREE_PER_DAY, awarded: 0 };
    await doneRef.set({ uid, result, at: FieldValue.serverTimestamp() });
    return { status: 200, body: result };
  }

  const stateRef = db.collection('presence_state').doc(uid);
  const stateSnap = await stateRef.get();
  const last = stateSnap.exists ? stateSnap.data() : null;
  const decision = offlineCheckinDecision({ place, fix, capturedAtMs, nowMs, last: last ? { lat: last.lat, lng: last.lng, atMs: last.atMs } : null, radiusOn });
  let verified = decision.tier === 'gps';
  let via = verified ? 'gps' : null;
  let reason = decision.reason;
  if (decision.tier === 'photo') {
    const photo = await photoCheck(db, { uid, landmarkId, photoURL, place });
    if (photo.failed) return { status: 503, body: { error: "Couldn't check the photo yet. It'll try again.", retry: true } };
    if (photo.ok) {
      verified = true;
      via = 'photo';
      reason = null;
    } else reason = photoURL ? 'photo-not-of-place' : 'needs-photo';
  }

  const { checkinId, visitNumber } = nextCheckinId(uid, landmarkId, prior);
  const userSnap = await db.collection('users').doc(uid).get();
  const userName = cleanUserName(userSnap.data()?.username || 'Explorer');
  const home = await homeOf(db, uid);
  const checkinRef = db.collection('checkins').doc(checkinId);
  const presence = verified
    ? { verified: true, placeType: decision.placeType, verifiedAt: FieldValue.serverTimestamp(), version: 2, offline: true, via }
    : { verified: false, reason, placeType: decision.placeType, checkedAt: FieldValue.serverTimestamp(), version: 2, offline: true };
  const created = await db.runTransaction(async (t) => {
    const [existing, dayDoc] = await Promise.all([t.get(checkinRef), t.get(dayRef)]);
    if (existing.exists) return false;
    if (!unlimited && (dayDoc.data()?.count || 0) >= OFFLINE_FREE_PER_DAY) return false;
    t.create(checkinRef, {
      userId: uid,
      userName,
      landmarkId,
      landmarkName: String(place.name || '').slice(0, 200),
      region: String(region || place.regionId || '').slice(0, 60),
      points: 0,
      basePoints: Number.isFinite(place.points) ? place.points : POINTS_PER_CHECKIN,
      visitNumber,
      ratingOnly: false,
      visited: true,
      insideHomeRadius: isNearHome(home, place),
      verification: 'offline',
      offline: true,
      // When they checked in, not when the phone got signal back.
      createdAt: Timestamp.fromMillis(capturedAtMs),
      syncedAt: FieldValue.serverTimestamp(),
      ...(photoURL && isOwnPlacePhoto(photoURL, uid, landmarkId) ? { photoURL, photoURLs: [photoURL] } : {}),
      presence,
    });
    t.set(checkinRef.collection('proof').doc('main'), {
      uid,
      lat: validFix(fix) ? fix.lat : null,
      lng: validFix(fix) ? fix.lng : null,
      accuracy: validFix(fix) ? fix.accuracy : null,
      fixAtMs: validFix(fix) ? fix.timestamp : null,
      mocked: validFix(fix) ? fix.mocked ?? null : null,
      distanceMeters: decision.distanceMeters,
      verified,
      via,
      reason,
      offline: true,
      capturedAtMs,
      checkedAt: FieldValue.serverTimestamp(),
    });
    t.set(dayRef, { uid, day, count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (verified && via === 'gps' && (!last || !(last.atMs > fix.timestamp))) {
      t.set(stateRef, { lat: fix.lat, lng: fix.lng, atMs: fix.timestamp, checkinId, updatedAt: FieldValue.serverTimestamp() });
    }
    return true;
  });
  if (!created) return { status: 409, body: { error: 'That check-in changed while saving. It will try again.', retry: true } };

  let awarded = 0;
  if (verified) {
    const today = await userDayKey(db, uid, nowMs);
    const paid = await pay(db, uid, checkinId, today, place).catch((e) => {
      console.error('offline-checkin payout failed', e);
      return { awarded: 0 };
    });
    awarded = paid.awarded || 0;
  }
  const result = { ok: true, saved: true, checkinId, verified, via, reason: verified ? null : reason, awarded };
  await doneRef.set({ uid, result, at: FieldValue.serverTimestamp() });
  // Points landed: an in-app notification and a push, so they hear about it
  // wherever they are in the app, or out of it (owner, 2026-11-25). Once:
  // a retried sync answers from offline_checkins above and never gets here.
  if (awarded > 0) await notify(db, uid, { name: place.name, awarded, landmarkId, region: String(region || place.regionId || '') }).catch(() => null);
  return { status: 200, body: result };
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!(await pointsAppCheckGate(req, res, 'offline-checkin'))) return;
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'offline-checkin', { ...OFFLINE_RATE_LIMIT, id: account.uid })) return send(res, 429, { error: 'Too many requests. It will try again later.', retry: true });
  const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
  if (!validClientId(body.clientId) || typeof body.landmarkId !== 'string' || !body.landmarkId || body.landmarkId.length > 300 || !validFix(body.fix) || !Number.isFinite(body.capturedAtMs)) {
    return send(res, 400, { error: 'clientId, landmarkId, a GPS fix and capturedAtMs are required.' });
  }
  if (body.photoURL != null && typeof body.photoURL !== 'string') return send(res, 400, { error: 'photoURL must be a string.' });
  try {
    const out = await syncOfflineCheckin(adminDb(), account.uid, body);
    return send(res, out.status, out.body);
  } catch (e) {
    console.error('offline-checkin failed', e);
    return send(res, 500, { error: "Couldn't sync this check-in. It will try again.", retry: true });
  }
}

export default withCors(handler);
