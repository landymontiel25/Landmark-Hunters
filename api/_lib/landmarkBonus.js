import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { validClientDayKey } from './streakDay.js';
import { cleanUserName, leaderboardPointWrites } from './leaderboardPoints.js';
import { withCors } from './cors.js';
import { specialPlace } from '../../src/data/specialPlaces.js';
import { isRealCheckin } from '../../src/lib/realCheckin.js';

// A place's own bonus (src/data/specialPlaces.js), e.g. 1,000 points at the
// Alhambra Water Tower, the first landmark ever in the app (owner,
// 2026-10-21). Paid once per account, for a real check-in there, on top of
// the usual check-in points. Decided here: the rules cap a client's points
// write at 100 (firestore.rules maxPointsPerWrite), on purpose.

// Pure: whether this account gets the place's bonus now.
export function landmarkBonusDecision({ special, checkins, paid }) {
  if (!special) return { awarded: 0, reason: 'not-special' };
  if (!checkins.some((c) => isRealCheckin(c))) return { awarded: 0, reason: 'no-checkin' };
  if (paid) return { awarded: 0, reason: 'already' };
  return { awarded: special.bonusPoints };
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

export async function awardLandmarkBonus(db, uid, regionId, landmarkId, dayId) {
  const special = specialPlace(regionId, landmarkId);
  if (!special) return { awarded: 0, reason: 'not-special' };
  const visits = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
  const checkins = visits.docs.map((d) => d.data());
  const paidRef = db.collection('landmark_bonuses').doc(`${uid}_${landmarkId}`);
  // In a transaction so two quick calls can't both pay.
  return db.runTransaction(async (t) => {
    const paid = (await t.get(paidRef)).exists;
    const decision = landmarkBonusDecision({ special, checkins, paid });
    if (!decision.awarded) return decision;
    t.create(paidRef, { userId: uid, regionId, landmarkId, points: decision.awarded, createdAt: FieldValue.serverTimestamp() });
    // Lifetime totals and levels (getUserStats adds bonusPoints) ...
    t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(decision.awarded) }, { merge: true });
    // ... and the weekly, monthly and yearly boards, on the caller's day.
    const userName = cleanUserName(checkins.find((c) => c.userName)?.userName);
    for (const [ref, data] of leaderboardPointWrites(db, uid, userName, decision.awarded, dayId)) t.set(ref, data, { merge: true });
    return decision;
  });
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
  if (isRateLimited(req, 'landmark-bonus', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { regionId, landmarkId, dayId } = req.body || {};
  if (!validId(regionId) || !validId(landmarkId) || !validClientDayKey(dayId)) {
    res.status(400).json({ error: 'regionId, landmarkId and dayId are required.' });
    return;
  }
  try {
    const out = await awardLandmarkBonus(adminDb(), account.uid, regionId, landmarkId, dayId);
    res.status(200).json({ ok: true, awarded: out.awarded, reason: out.reason || null });
  } catch (e) {
    console.error('[landmark-bonus] failed', e);
    res.status(500).json({ error: 'Could not check the landmark bonus.' });
  }
}

export default withCors(handler);
