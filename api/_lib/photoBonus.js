import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { validClientDayKey } from './streakDay.js';
import { awardLeaderboardPointsServer, cleanUserName } from './leaderboardPoints.js';
import { withCors } from './cors.js';

// Bonus points for a photo (owner, 2026-10-21): +10 the first time you add
// a photo at a place you really checked in to, once per place, at most 5
// places a day. Decided here, not on the phone: the rules let no client
// write raise points (firestore.rules), so a photo can't be faked into a
// payout. Small next to a first check-in (100, leaderboard.js) and a solo
// streak day (20): it nudges people to add photos without making junk
// photos worth farming.
export const PHOTO_BONUS_POINTS = 10;
export const PHOTO_BONUSES_PER_DAY = 5;

const hasPhoto = (d) => !!d && ((Array.isArray(d.photoURLs) && d.photoURLs.length > 0) || !!d.photoURL);

// A real visit: a check-in that isn't a rating-only claim (those are 0-point
// "Rate a Landmark" entries; see soloPicks.js isRatingOnlyClaim).
const realVisit = (c) => !!c && !c.ratingOnly && c.visited !== false;

// Pure: whether this photo earns the bonus, and why not when it doesn't.
// checkin: checkins/{uid}_{landmarkId}; review: reviews/{uid}_{landmarkId}
// (photos taken while rating at check-in land on the review); paid: the
// ledger doc already exists; today: bonuses paid so far on this day.
export function photoBonusDecision({ uid, checkin, review, paid, today }) {
  if (!checkin || checkin.userId !== uid || !realVisit(checkin)) return { awarded: 0, reason: 'no-checkin' };
  if (!hasPhoto(checkin) && !(review && review.userId === uid && hasPhoto(review))) return { awarded: 0, reason: 'no-photo' };
  if (paid) return { awarded: 0, reason: 'already' };
  if (today >= PHOTO_BONUSES_PER_DAY) return { awarded: 0, reason: 'daily-limit' };
  return { awarded: PHOTO_BONUS_POINTS };
}

const validLandmarkId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

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
  if (isRateLimited(req, 'photo-bonus', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { landmarkId, dayId } = req.body || {};
  if (!validLandmarkId(landmarkId) || !validClientDayKey(dayId)) {
    res.status(400).json({ error: 'landmarkId and dayId are required.' });
    return;
  }

  try {
    const db = adminDb();
    const uid = account.uid;
    const docId = `${uid}_${landmarkId}`;
    const checkinRef = db.collection('checkins').doc(docId);
    const reviewRef = db.collection('reviews').doc(docId);
    // Server-only ledgers (no client can write them): one per place paid,
    // and a per-day count for the daily limit.
    const paidRef = db.collection('photo_bonuses').doc(docId);
    const dayRef = db.collection('photo_bonus_days').doc(`${uid}_${dayId}`);

    // In a transaction so two quick calls (two photos added at once) can't
    // both pay for the same place, or both slip under the daily limit.
    const outcome = await db.runTransaction(async (t) => {
      const [checkinSnap, reviewSnap, paidSnap, daySnap] = await Promise.all([
        t.get(checkinRef),
        t.get(reviewRef),
        t.get(paidRef),
        t.get(dayRef),
      ]);
      const checkin = checkinSnap.exists ? checkinSnap.data() : null;
      const decision = photoBonusDecision({
        uid,
        checkin,
        review: reviewSnap.exists ? reviewSnap.data() : null,
        paid: paidSnap.exists,
        today: daySnap.exists ? Number(daySnap.data().count) || 0 : 0,
      });
      if (!decision.awarded) return decision;
      t.create(paidRef, { userId: uid, landmarkId, dayId, points: decision.awarded, createdAt: FieldValue.serverTimestamp() });
      t.set(dayRef, { userId: uid, dayId, count: FieldValue.increment(1) }, { merge: true });
      // In lifetime totals and levels (getUserStats adds bonusPoints).
      t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(decision.awarded) }, { merge: true });
      return { ...decision, userName: cleanUserName(checkin.userName) };
    });

    if (outcome.awarded) {
      // The weekly, monthly and yearly boards, on the caller's own day.
      await awardLeaderboardPointsServer(db, uid, outcome.userName, outcome.awarded, dayId).catch((e) =>
        console.error('[photo-bonus] leaderboard award failed', e)
      );
    }
    res.status(200).json({ ok: true, awarded: outcome.awarded, reason: outcome.reason || null });
  } catch (e) {
    console.error('[photo-bonus] failed', e);
    res.status(500).json({ error: 'Could not check the photo bonus.' });
  }
}

export default withCors(handler);
