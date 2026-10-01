import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { previousDayKey, validClientDayKey, isDayBefore } from './_lib/streakDay.js';
import { pickDailyCardIds } from '../src/lib/sharedDeck.js';
import { awardLeaderboardPointsServer } from './_lib/leaderboardPoints.js';
import { withCors } from './_lib/cors.js';

// Points for a secured solo day, and one-time bonuses the first time a
// streak reaches a milestone length -- half the dual-streak amounts (see
// close-streak-day.js), since a solo day is one person rating 3 landmarks
// versus a pair coordinating to rate AND guess all 3. Values chosen against
// POINTS_PER_CHECKIN (100, leaderboard.js) as the app's existing point
// scale: a solo day is a fifth of a check-in, a dual day a half.
export const SOLO_DAY_POINTS = 20;
export const SOLO_MILESTONE_POINTS = { 3: 100, 7: 300, 30: 1000 };

// Solo streaks' day-close: rate today's 3 (no guess, no partner) and the
// count moves -- the same server-authority pattern as close-streak-day.js,
// just for a single-member streaks/{uid} doc. No recovery mission (not
// part of the solo rules) and no push notification (no partner to notify).
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
  if (isRateLimited(req, 'close-solo-streak-day', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { dayId } = req.body || {};
  if (!validClientDayKey(dayId)) {
    res.status(400).json({ error: 'dayId is required.' });
    return;
  }

  try {
    const db = adminDb();
    const streakRef = db.collection('streaks').doc(account.uid);
    const streakSnap = await streakRef.get();
    if (!streakSnap.exists) {
      res.status(404).json({ error: 'No such streak.' });
      return;
    }
    const streak = streakSnap.data();
    if (streak.mode !== 'solo' || !(streak.memberIds || []).includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }
    // Already closed for this day -- report the current state, no-op, no
    // points (a repeat call, e.g. a reload, must never double-award).
    if (streak.lastCompletedDay === dayId) {
      res.status(200).json({ ok: true, closed: true, already: true, count: streak.count, best: streak.best });
      return;
    }
    if (!streak.cityId) {
      res.status(200).json({ ok: true, closed: false, reason: 'no-city' });
      return;
    }

    const checkinsSnap = await db.collection('checkins').where('userId', '==', account.uid).get();
    const visitedIds = new Set(
      checkinsSnap.docs
        .map((d) => d.data())
        .filter((c) => c.ratingOnly ? false : typeof c.visited === 'boolean' ? c.visited : c.points !== 0)
        .map((c) => c.landmarkId)
    );
    const cardIds = pickDailyCardIds(account.uid, dayId, streak.cityId, visitedIds);
    const entrySnap = await streakRef.collection('days').doc(dayId).collection('entries').doc(account.uid).get();
    const entry = entrySnap.exists ? entrySnap.data() : null;
    const done = entry && cardIds.length > 0 && cardIds.every((id) => entry.ratings?.[id]);
    if (!done) {
      res.status(200).json({ ok: true, closed: false });
      return;
    }

    // Re-read and write inside a transaction so two overlapping calls (a
    // double tap, two open tabs) can't both advance the count and both pay out.
    const outcome = await db.runTransaction(async (t) => {
      const fresh = (await t.get(streakRef)).data() || streak;
      if (fresh.lastCompletedDay === dayId) {
        return { already: true, count: fresh.count, best: fresh.best };
      }
      // Never move lastCompletedDay backwards (e.g. a late call for yesterday).
      if (fresh.lastCompletedDay && isDayBefore(dayId, fresh.lastCompletedDay)) {
        return { stale: true };
      }
      // A frozen day (api/use-solo-streak-freeze.js) bridges one gap the same
      // way a dual streak's shared freeze does -- it holds the count, it
      // doesn't add to it.
      const bridged =
        fresh.lastCompletedDay === previousDayKey(dayId) || (fresh.frozenDays || []).includes(previousDayKey(dayId));
      const count = bridged ? (fresh.count || 0) + 1 : 1;
      const best = Math.max(fresh.best || 0, count);
      // No recovery mission for solo (spec: solo has no shared freezes, no
      // recovery mission, no reveal) -- a break with no freeze left just
      // resets, same as it always would have under the old live-computed
      // count.
      t.update(streakRef, { count, best, lastCompletedDay: dayId, updatedAt: FieldValue.serverTimestamp() });
      return { closed: true, count, best };
    });
    if (outcome.already) {
      res.status(200).json({ ok: true, closed: true, already: true, count: outcome.count, best: outcome.best });
      return;
    }
    if (outcome.stale) {
      res.status(200).json({ ok: true, closed: false, reason: 'stale-day' });
      return;
    }
    const nextCount = outcome.count;
    const nextBest = outcome.best;
    const milestone = SOLO_MILESTONE_POINTS[nextCount] || 0;
    const userName = streak.memberNames?.[account.uid];
    await awardLeaderboardPointsServer(db, account.uid, userName, SOLO_DAY_POINTS + milestone);
    res.status(200).json({
      ok: true,
      closed: true,
      count: nextCount,
      best: nextBest,
      pointsAwarded: SOLO_DAY_POINTS,
      milestoneAwarded: milestone || null,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not close that day.' });
  }
}

export default withCors(handler);
