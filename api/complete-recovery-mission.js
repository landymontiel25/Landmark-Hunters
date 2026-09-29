import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { monthKey } from './_lib/streakDay.js';
import { withCors } from './_lib/cors.js';

const THIRTY_MIN_MS = 30 * 60 * 1000;

// Duplicated from leaderboard.js's isRealCheckin (pure logic, not worth
// pulling that whole client-Firebase-importing module in for -- see
// _lib/streakDay.js's comment on why that crashes a serverless function).
function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}

// Recovery mission (item 7): a 24h window after a break with no freezes
// left (opened by close-streak-day.js). Both members check in at the same
// landmark within 30 minutes of each other; long-distance pairs succeed if
// each has any real check-in inside the window instead. Once per pair per
// month. Success restores the count to what it was before the break --
// functionally the same as a freeze would have, just after the fact.
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
  if (isRateLimited(req, 'complete-recovery-mission', { limit: 10, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { pairId } = req.body || {};
  if (!pairId || typeof pairId !== 'string') {
    res.status(400).json({ error: 'pairId is required.' });
    return;
  }

  try {
    const db = adminDb();
    const streakRef = db.collection('streaks').doc(pairId);
    const streakSnap = await streakRef.get();
    if (!streakSnap.exists) {
      res.status(404).json({ error: 'No such streak.' });
      return;
    }
    const streak = streakSnap.data();
    const memberIds = streak.memberIds || [];
    if (!memberIds.includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }
    if (!streak.recoveryOpenUntil || Date.now() > streak.recoveryOpenUntil) {
      res.status(200).json({ ok: false, error: 'No recovery mission open for this streak right now.' });
      return;
    }
    const thisMonth = monthKey(new Date());
    if (streak.recoveryUsedMonth === thisMonth) {
      res.status(200).json({ ok: false, error: 'Already used your recovery mission this month.' });
      return;
    }

    const windowStart = streak.recoveryOpenUntil - 24 * 60 * 60 * 1000;
    const checkinsByMember = await Promise.all(
      memberIds.map(async (uid) => {
        const snap = await db.collection('checkins').where('userId', '==', uid).get();
        return snap.docs
          .map((d) => d.data())
          .filter((c) => isRealCheckin(c) && (c.createdAt?.toMillis?.() || 0) >= windowStart);
      })
    );
    const [mine, theirs] = checkinsByMember;

    const sameLandmarkTogether = mine.some((a) =>
      theirs.some(
        (b) =>
          a.landmarkId === b.landmarkId &&
          Math.abs((a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)) <= THIRTY_MIN_MS
      )
    );
    const longDistanceOk = mine.length > 0 && theirs.length > 0;
    if (!sameLandmarkTogether && !longDistanceOk) {
      res.status(200).json({ ok: false, error: "Neither of you has checked in yet -- get out there and check in!" });
      return;
    }

    await streakRef.update({
      count: streak.recoveryPriorCount || 0,
      best: Math.max(streak.best || 0, streak.recoveryPriorCount || 0),
      recoveryOpenUntil: FieldValue.delete(),
      recoveryPriorCount: FieldValue.delete(),
      recoveryUsedMonth: thisMonth,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ ok: true, count: streak.recoveryPriorCount || 0 });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not complete the recovery mission.' });
  }
}

export default withCors(handler);
