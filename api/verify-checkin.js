import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getLandmark, canonicalLandmarkId } from '../src/data/regions.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { checkPresence, validFix } from '../src/lib/presence.js';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';

// Verified presence (docs/discovery-network-plan.md, Phase 0). Right after a
// check-in is saved, the app sends a fresh GPS fix here. The server loads the
// place itself, runs checkPresence (src/lib/presence.js), and writes the
// result to the check-in's `presence` field with the Admin SDK. The rules
// stop any client from writing `presence`, so "Verified visit" means this
// endpoint said so. The raw fix goes to checkins/{id}/proof/main and the last
// verified fix to presence_state/{uid} (impossible-travel check); both are
// server-only.
//
// The check-in never waits for this: a failed or skipped call leaves an
// unverified check-in, which still counts for streaks and badges.

export const VERIFY_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };


// The place as the server knows it: catalog and place packs first, then a
// user-added landmark.
async function loadPlace(db, region, landmarkId) {
  await ensureServerPlacePacks();
  const id = canonicalLandmarkId(landmarkId, region);
  const known = (region && getLandmark(region, id)) || null;
  if (known) return known;
  const snap = await db.collection('custom_landmarks').doc(landmarkId).get();
  return snap.exists ? snap.data() : null;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
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
  if (typeof checkinId !== 'string' || !/^[\w.-]{1,300}$/.test(checkinId) || !validFix(fix)) {
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
      res.status(200).json({ ok: true, verified: true, reason: null, already: true });
      return;
    }

    const place = await loadPlace(db, checkin.region, checkin.landmarkId);
    const stateRef = db.collection('presence_state').doc(account.uid);
    const stateSnap = await stateRef.get();
    const last = stateSnap.exists ? stateSnap.data() : null;
    const nowMs = Date.now();
    const result = checkPresence({
      place,
      fix,
      nowMs,
      checkinAtMs: toMs(checkin.createdAt),
      last: last ? { lat: last.lat, lng: last.lng, atMs: last.atMs } : null,
    });

    const presence = result.verified
      ? {
          verified: true,
          distanceMeters: result.distanceMeters,
          accuracyMeters: result.accuracyMeters,
          placeType: result.placeType,
          verifiedAt: FieldValue.serverTimestamp(),
          version: 1,
        }
      : {
          verified: false,
          reason: result.reason,
          ...(result.reason === 'too-far' ? { distanceMeters: result.distanceMeters } : {}),
          placeType: result.placeType,
          checkedAt: FieldValue.serverTimestamp(),
          version: 1,
        };

    const batch = db.batch();
    batch.update(checkinRef, { presence });
    batch.set(checkinRef.collection('proof').doc('main'), {
      uid: account.uid,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      fixAtMs: fix.timestamp,
      mocked: fix.mocked ?? null,
      distanceMeters: result.distanceMeters,
      verified: result.verified,
      reason: result.reason,
      checkedAt: FieldValue.serverTimestamp(),
    });
    if (result.verified) {
      batch.set(stateRef, { lat: fix.lat, lng: fix.lng, atMs: fix.timestamp, checkinId, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    res.status(200).json({
      ok: true,
      verified: result.verified,
      reason: result.reason,
      distanceMeters: result.distanceMeters,
    });
  } catch (err) {
    console.error('verify-checkin failed', err);
    res.status(500).json({ error: 'Could not verify this check-in.' });
  }
}

export default withCors(handler);
