import { verifyIdToken } from './_lib/verifyAuth.js';
import { pointsAppCheckGate } from './_lib/appCheck.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getLandmark, canonicalLandmarkId } from '../src/data/regions.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { checkPresence, validFix, placeTypeFor } from '../src/lib/presence.js';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import { userDayKey } from './_lib/streakClock.js';
import { payVerifiedCheckin } from './_lib/checkinPayout.js';
import { isApprovedLandmark } from '../src/lib/landmarkApproval.js';
import { ADMIN_CHECKIN_ANYWHERE, isAdmin } from '../src/lib/admins.js';

// Verified presence (docs/discovery-network-plan.md, Phase 0). Right after a
// check-in is saved, the app sends a fresh GPS fix here. The server loads the
// place itself, runs checkPresence (src/lib/presence.js), and writes the
// result to the check-in's `presence` field with the Admin SDK. The rules
// stop any client from writing `presence`, so "Verified visit" means this
// endpoint said so. The raw fix goes to checkins/{id}/proof/main and the last
// verified fix to presence_state/{uid} (impossible-travel check); both are
// server-only.
//
// It is also the only place check-in points are paid (checkinPayout.js):
// a verified visit, at a place the server itself loaded from the catalog
// (an unknown place id can't be verified: 'no-place'), pays the account's
// one-time check-in points. An unverified check-in pays nothing, anywhere.

export const VERIFY_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };


// The place as the server knows it: catalog and place packs first, then a
// user-added landmark.
async function loadPlace(db, region, landmarkId) {
  await ensureServerPlacePacks();
  const id = canonicalLandmarkId(landmarkId, region);
  const known = (region && getLandmark(region, id)) || null;
  if (known) return known;
  // A user-added place counts only once the owner approved it (or it was
  // grandfathered): a pending one can't be verified, so it pays nothing.
  const snap = await db.collection('custom_landmarks').doc(landmarkId).get();
  return snap.exists && isApprovedLandmark(snap.data()) ? snap.data() : null;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // App Check on every endpoint that pays points (item 5; APP_CHECK_POINTS_MODE).
  if (!(await pointsAppCheckGate(req, res, 'verify-checkin'))) return;
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'verify-checkin', { ...VERIFY_RATE_LIMIT, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { checkinId, fix } = req.body || {};
  // The admin's check-in-from-anywhere switch (src/lib/admins.js): their
  // own check-ins verify without being there. Signed-in, verified email only.
  const anywhere = ADMIN_CHECKIN_ANYWHERE && account.emailVerified && isAdmin(account.email);
  if (typeof checkinId !== 'string' || !/^[\w.-]{1,300}$/.test(checkinId) || (!anywhere && !validFix(fix))) {
    res.status(400).json({ error: 'checkinId and a GPS fix are required.' });
    return;
  }

  try {
    const db = adminDb();
    const checkinRef = db.collection('checkins').doc(checkinId);
    const snap = await checkinRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'No such check-in.' });
      return;
    }
    const checkin = snap.data();
    if (checkin.userId !== account.uid) {
      res.status(403).json({ error: "That's not your check-in." });
      return;
    }
    if (checkin.ratingOnly || checkin.visited === false) {
      res.status(400).json({ error: 'A rating is not a visit.' });
      return;
    }
    // Once verified, it stays verified; a retry can't change it.
    if (checkin.presence?.verified === true) {
      res.status(200).json({ ok: true, verified: true, reason: null, already: true, awarded: 0 });
      return;
    }

    const place = await loadPlace(db, checkin.region, checkin.landmarkId);
    const stateRef = db.collection('presence_state').doc(account.uid);
    const stateSnap = await stateRef.get();
    const last = stateSnap.exists ? stateSnap.data() : null;
    const nowMs = Date.now();
    const real = validFix(fix);
    const result = anywhere
      ? { verified: !!place, reason: place ? null : 'no-place', placeType: place ? placeTypeFor(place) : null, distanceMeters: null, adminAnywhere: true }
      : checkPresence({
      place,
      fix,
      nowMs,
      checkinAtMs: toMs(checkin.createdAt),
      last: last ? { lat: last.lat, lng: last.lng, atMs: last.atMs } : null,
    });

    // No distance or GPS accuracy on the check-in (Phase 2): anyone who may
    // read it would see them. They stay in the server-only proof below.
    const presence = result.verified
      ? { verified: true, placeType: result.placeType, verifiedAt: FieldValue.serverTimestamp(), version: 2, ...(result.adminAnywhere ? { adminAnywhere: true } : {}) }
      : { verified: false, reason: result.reason, placeType: result.placeType, checkedAt: FieldValue.serverTimestamp(), version: 2 };

    const batch = db.batch();
    batch.update(checkinRef, { presence });
    batch.set(checkinRef.collection('proof').doc('main'), {
      uid: account.uid,
      lat: real ? fix.lat : null,
      lng: real ? fix.lng : null,
      accuracy: real ? fix.accuracy : null,
      fixAtMs: real ? fix.timestamp : null,
      mocked: real ? fix.mocked ?? null : null,
      ...(result.adminAnywhere ? { adminAnywhere: true } : {}),
      distanceMeters: result.distanceMeters,
      verified: result.verified,
      reason: result.reason,
      checkedAt: FieldValue.serverTimestamp(),
    });
    if (result.verified && real) {
      batch.set(stateRef, { lat: fix.lat, lng: fix.lng, atMs: fix.timestamp, checkinId, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    // Paid only now, after the verified presence is saved. The board day is
    // the caller's own day, checked; anything else falls back to today.
    let awarded = 0;
    if (result.verified) {
      // The boards' day is the server's (the user's pinned streak zone).
      const day = await userDayKey(db, account.uid);
      const paid = await payVerifiedCheckin(db, account.uid, checkinId, day, place).catch((e) => {
        console.error('verify-checkin payout failed', e);
        return { awarded: 0 };
      });
      awarded = paid.awarded || 0;
    }

    res.status(200).json({ ok: true, verified: result.verified, reason: result.reason, awarded });
  } catch (err) {
    console.error('verify-checkin failed', err);
    res.status(500).json({ error: 'Could not verify this check-in.' });
  }
}

export default withCors(handler);
