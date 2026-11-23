import { FieldValue } from 'firebase-admin/firestore';
import { POINTS_PER_CHECKIN, HOME_RADIUS_METERS, HOME_RADIUS_EXCLUSION_ENABLED } from '../../src/lib/checkinPoints.js';
import { haversineMeters } from '../../src/lib/haversine.js';
import { isRealCheckin } from '../../src/lib/realCheckin.js';
import { cleanUserName, leaderboardPointWrites } from './leaderboardPoints.js';

// Check-in points are paid here, on the server, and only for a visit the
// server just verified (owner, 2026-11-23). Before, the phone wrote its own
// points: any check-in, at any place id, from anywhere, could claim them.
// An account is paid once, for its first verified check-in: 100 points on
// the check-in, the weekly/monthly/yearly boards, and checkin_payouts/{uid}
// so it can't be paid twice. An account paid under the old client rule
// (it has that doc, or a check-in with points) is never paid again.

// Pure: what this verified check-in earns.
export function checkinPayoutDecision({ checkin, verified, paid, paidBefore, nearHome = false }) {
  if (!verified) return { awarded: 0, reason: 'not-verified' };
  if (!checkin || !isRealCheckin(checkin)) return { awarded: 0, reason: 'not-a-visit' };
  if (nearHome) return { awarded: 0, reason: 'near-home' };
  if (paid || paidBefore) return { awarded: 0, reason: 'already' };
  return { awarded: POINTS_PER_CHECKIN };
}

// The account's saved home (the private doc, else a pre-split profile).
async function homeOf(db, uid) {
  const read = async (get) => {
    try {
      const s = await get();
      const h = s?.exists ? s.data()?.homeCoords : null;
      return h && Number.isFinite(h.lat) && Number.isFinite(h.lng) ? h : null;
    } catch {
      return null;
    }
  };
  return (
    (await read(() => db.collection('users').doc(uid).collection('private').doc('main').get())) ||
    read(() => db.collection('users').doc(uid).get())
  );
}

export function isNearHome(home, place) {
  if (!HOME_RADIUS_EXCLUSION_ENABLED || !home || !Number.isFinite(place?.lat) || !Number.isFinite(place?.lng)) return false;
  return haversineMeters(home.lat, home.lng, place.lat, place.lng) <= HOME_RADIUS_METERS;
}

// place: the landmark as the server loaded it (its lat/lng).
export async function payVerifiedCheckin(db, uid, checkinId, dayId, place = null) {
  const nearHome = isNearHome(await homeOf(db, uid), place);
  const checkinRef = db.collection('checkins').doc(checkinId);
  const payoutRef = db.collection('checkin_payouts').doc(uid);
  // A check-in that already carries points (paid under the old rule).
  // (Filtered here rather than with a points > 0 query, which would need
  // another composite index.)
  const mine = await db.collection('checkins').where('userId', '==', uid).select('points').get();
  const paidBefore = mine.docs.some((d) => d.id !== checkinId && Number(d.data().points) > 0);
  return db.runTransaction(async (t) => {
    const [c, p] = await Promise.all([t.get(checkinRef), t.get(payoutRef)]);
    const checkin = c.exists ? c.data() : null;
    const decision = checkinPayoutDecision({
      checkin,
      verified: checkin?.presence?.verified === true,
      paid: p.exists,
      paidBefore,
      nearHome,
    });
    if (!decision.awarded) return decision;
    t.create(payoutRef, { checkinId, points: decision.awarded, createdAt: FieldValue.serverTimestamp() });
    t.update(checkinRef, { points: decision.awarded });
    for (const [ref, data] of leaderboardPointWrites(db, uid, cleanUserName(checkin.userName), decision.awarded, dayId)) t.set(ref, data, { merge: true });
    return decision;
  });
}
