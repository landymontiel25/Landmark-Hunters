import { verifyIdToken } from './verifyAuth.js';
import { pointsAppCheckGate } from './appCheck.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { awardLeaderboardPointsServer, cleanUserName } from './leaderboardPoints.js';
import { photoShowsPlace } from './photoCheck.js';
import { guardPhoto, isOwnPlacePhoto } from './photoGuard.js';
import { userDayKey } from './streakClock.js';
import { takeDailyQuota } from './usageQuota.js';
import { withCors } from './cors.js';
import { INTERESTS, getLandmark, getRegion } from '../../src/data/regions.js';
import { isVerifiedCheckin } from '../../src/lib/realCheckin.js';
import { CHECKIN_RULE_METERS } from '../../src/lib/maprConstants.js';

// Bonus points for a photo (owner, 2026-10-21): +10 the first time you add
// a photo at a place you really checked in to, once per place, at most 5
// places a day, and only when the photo shows the place or the visit (a
// Claude check, photoCheck.js: no black screens, screenshots or random
// photos). Decided here, not on the phone: the rules let no client write
// raise points (firestore.rules). Small next to a first check-in (100,
// leaderboard.js) and a solo streak day (20): it nudges people to add
// photos without making photos worth farming.
export const PHOTO_BONUS_POINTS = 10;
export const PHOTO_BONUSES_PER_DAY = 5;
// Photos checked per place per try, newest first, so one call can't run up
// a long bill on a place with many photos.
export const PHOTOS_CHECKED_PER_TRY = 3;
// Photos turned down by an earlier version of the check are checked again
// under this one (2026-11-22: the check now knows the whole property and
// that the GPS visit proved they were there). Bump to re-open them again.
export const CHECKED_FIELD = 'urlsV2';

const photosOf = (d) => [...(Array.isArray(d?.photoURLs) ? d.photoURLs : []), ...(d?.photoURL ? [d.photoURL] : [])].filter((u) => typeof u === 'string');
const hasPhoto = (d) => photosOf(d).length > 0;

// A real visit the server verified (realCheckin.js isVerifiedCheckin): not
// a rating-only entry, and not a check-in the GPS check didn't confirm.
const realVisit = (c) => !!c && isVerifiedCheckin(c);

// Pure: whether this place can earn the bonus (before the photo check), and
// why not when it can't. checkin: checkins/{uid}_{landmarkId}; review:
// reviews/{uid}_{landmarkId} (photos taken while rating at check-in land
// there); paid: the ledger doc already exists; today: bonuses paid so far
// on this day (null skips the daily limit, for the one-time back-pay);
// visited: a real visit here on any check-in doc, when the first doc (where
// photos are kept) is a rating-only one (defaults to that doc's own answer).
export function photoBonusDecision({ uid, checkin, review, paid, today, visited }) {
  if (!checkin || checkin.userId !== uid || !(visited ?? realVisit(checkin))) return { awarded: 0, reason: 'no-checkin' };
  if (!hasPhoto(checkin) && !(review && review.userId === uid && hasPhoto(review))) return { awarded: 0, reason: 'no-photo' };
  if (paid) return { awarded: 0, reason: 'already' };
  if (today != null && today >= PHOTO_BONUSES_PER_DAY) return { awarded: 0, reason: 'daily-limit' };
  return { awarded: PHOTO_BONUS_POINTS };
}

// The photos to check: the newest first (the one just added), skipping any
// checked before, a few at most.
// retry: the traveler asked to check again, so the newest photo is checked
// even if it was turned down before.
export function photosToCheck({ uid, checkin, review, checked = [], retry = false }) {
  const mine = review && review.userId === uid ? photosOf(review) : [];
  const newest = [...photosOf(checkin).reverse(), ...mine.reverse()][0];
  const seen = new Set(checked.filter((u) => !(retry && u === newest)));
  return [...new Set([...photosOf(checkin).reverse(), ...mine.reverse()])].filter((u) => !seen.has(u)).slice(0, PHOTOS_CHECKED_PER_TRY);
}

const kindLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;

// A place's check-in area (the same rule as src/lib/checkinRules.js radiusFor,
// which plain Node can't import).
const radiusFor = (lm) => (Number.isFinite(lm?.checkInRadiusMeters) && lm.checkInRadiusMeters > 0 ? lm.checkInRadiusMeters : CHECKIN_RULE_METERS);

export function placeInfo(landmarkId, checkin) {
  const lm = getLandmark(checkin.region, landmarkId);
  return {
    name: lm?.name || checkin.landmarkName || landmarkId,
    kinds: (lm?.categories || []).map(kindLabel).join(', '),
    city: getRegion(checkin.region)?.name || '',
    description: String(lm?.whatItIs || lm?.summary || lm?.description || '').slice(0, 400),
    // What's on the property (a landmark's photoScenes), for big places.
    scenes: Array.isArray(lm?.photoScenes) ? lm.photoScenes : [],
    radiusMeters: lm ? radiusFor(lm) : null,
    // The place's own catalog photos, sent as references (photoCheck.js).
    images: Array.isArray(lm?.images) ? lm.images : [],
  };
}

// What a turned-down photo should have shown, said plainly to the traveler.
export function expectedPhoto(place) {
  return place.scenes?.length ? `a photo of ${place.name} or anywhere on it: ${place.scenes.join(', ')}` : `a photo of ${place.name}: the place itself, its inside, or the view from it`;
}

// One place, start to end: the checks, the photo check, then the payout in
// a transaction. Used by the endpoint (daily limit and the weekly/monthly/
// yearly boards on) and by the one-time back-pay (both off).
export async function awardPhotoBonus(db, uid, landmarkId, { dayId = null, dailyLimit = true, boards = true, check = photoShowsPlace, retry = false, guard = guardPhoto, quota = takeDailyQuota } = {}) {
  const docId = `${uid}_${landmarkId}`;
  const checkinRef = db.collection('checkins').doc(docId);
  const reviewRef = db.collection('reviews').doc(docId);
  // Server-only (firestore.rules): one doc per place paid, a per-day count,
  // and the photos already checked for a place (never checked twice).
  const paidRef = db.collection('photo_bonuses').doc(docId);
  const dayRef = dayId ? db.collection('photo_bonus_days').doc(`${uid}_${dayId}`) : null;
  const checksRef = db.collection('photo_bonus_checks').doc(docId);

  const read = async (get) => {
    const [c, r, p, d] = await Promise.all([get(checkinRef), get(reviewRef), get(paidRef), dayRef ? get(dayRef) : null]);
    return {
      checkin: c.exists ? c.data() : null,
      review: r.exists ? r.data() : null,
      paid: p.exists,
      today: dailyLimit ? (d?.exists ? Number(d.data().count) || 0 : 0) : null,
    };
  };

  const first = await read((ref) => ref.get());
  // Photos live on the first check-in doc. If that one was a rating-only
  // entry, a later real visit (doc _2, _3...) still counts.
  let visited;
  if (first.checkin && !realVisit(first.checkin)) {
    const all = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
    visited = all.docs.some((d) => isVerifiedCheckin(d.data()));
  }
  const pre = photoBonusDecision({ uid, ...first, visited });
  if (!pre.awarded) return pre;

  // Does a photo show the place? Newest first; the first yes is enough.
  const checksSnap = await checksRef.get();
  const checked = checksSnap.exists ? checksSnap.data()[CHECKED_FIELD] || [] : [];
  // Only the caller's own photos of this place (photoGuard.js).
  const urls = photosToCheck({ uid, checkin: first.checkin, review: first.review, checked, retry }).filter((u) => isOwnPlacePhoto(u, uid, landmarkId));
  const place = placeInfo(landmarkId, first.checkin);
  const expected = expectedPhoto(place);
  if (!urls.length) return { awarded: 0, reason: 'photo-not-of-place', expected, why: null };
  let verdict = null;
  let lastNo = null;
  const tried = [];
  for (const url of urls) {
    // A photo someone else already used, or that this account used at
    // another place, is turned down before any AI is asked.
    const g = await guard(db, url, { uid, landmarkId });
    if (!g.ok) {
      tried.push(url);
      lastNo = { reason: g.reason === 'duplicate-photo' ? 'This photo was already used, by someone else or for another place.' : "This photo couldn't be read." };
      continue;
    }
    // A daily cap on AI photo checks per account and overall (item 5).
    const q = await quota('ai-photo', { uid });
    if (!q.ok) return { awarded: 0, reason: 'check-limit' };
    const v = await check({ url, place });
    // A failed call isn't a verdict: that photo can be checked again later.
    if (!v.failed && v.reason !== 'check failed') {
      tried.push(url);
      if (!v.ok) lastNo = v;
    }
    if (v.ok) {
      verdict = v;
      break;
    }
  }
  if (tried.length) await checksRef.set({ userId: uid, [CHECKED_FIELD]: FieldValue.arrayUnion(...tried) }, { merge: true });
  // Every call failed: say so (Try again), never a silent no.
  if (!verdict && !tried.length) return { awarded: 0, reason: 'check-failed' };
  if (!verdict) return { awarded: 0, reason: 'photo-not-of-place', expected, why: lastNo?.reason || null };

  // In a transaction so two quick calls can't both pay for the same place,
  // or both slip under the daily limit.
  const outcome = await db.runTransaction(async (t) => {
    const now = await read((ref) => t.get(ref));
    const decision = photoBonusDecision({ uid, ...now, visited });
    if (!decision.awarded) return decision;
    t.create(paidRef, { userId: uid, landmarkId, dayId, points: decision.awarded, photo: verdict.reason, createdAt: FieldValue.serverTimestamp() });
    if (dayRef) t.set(dayRef, { userId: uid, dayId, count: FieldValue.increment(1) }, { merge: true });
    // In lifetime totals and levels (getUserStats adds bonusPoints).
    t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(decision.awarded) }, { merge: true });
    return { ...decision, userName: cleanUserName(now.checkin.userName) };
  });
  if (outcome.awarded && boards && dayId) {
    // The weekly, monthly and yearly boards, on the caller's own day.
    await awardLeaderboardPointsServer(db, uid, outcome.userName, outcome.awarded, dayId).catch((e) =>
      console.error('[photo-bonus] leaderboard award failed', e)
    );
  }
  return { awarded: outcome.awarded, reason: outcome.reason };
}

const validLandmarkId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // App Check on every endpoint that pays points (item 5; APP_CHECK_POINTS_MODE).
  if (!(await pointsAppCheckGate(req, res, 'photo-bonus'))) return;
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'photo-bonus', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  // The day (the daily cap, the boards) is the server's, never the phone's.
  const { landmarkId, retry } = req.body || {};
  if (!validLandmarkId(landmarkId)) {
    res.status(400).json({ error: 'landmarkId is required.' });
    return;
  }
  try {
    const db = adminDb();
    const dayId = await userDayKey(db, account.uid);
    const out = await awardPhotoBonus(db, account.uid, landmarkId, { dayId, retry: retry === true });
    res.status(200).json({ ok: true, awarded: out.awarded, reason: out.reason || null, expected: out.expected || null, why: out.why || null });
  } catch (e) {
    console.error('[photo-bonus] failed', e);
    res.status(500).json({ error: 'Could not check the photo bonus.' });
  }
}

export default withCors(handler);
