import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { previousDayKey, isDayBefore } from './streakDay.js';
import { pickDailyCardIds } from '../../src/lib/sharedDeck.js';
import { canonicalLandmarkId } from '../../src/data/regions.js';
import { leaderboardPointWrites } from './leaderboardPoints.js';
import { withCors } from './cors.js';
import { SOLO_PICK_VOTES_REQUIRED } from './soloPicks.js';
import { pinZone, serverDay, distinctActionsOnDay, hasVerifiedCheckinOnDay, answeredBeforeDay, assignDeck } from './streakClock.js';

const VERDICTS = new Set(['yes', 'no', 'unsure']);

// Points for a secured solo day, and one-time bonuses the first time a
// streak reaches a milestone length (paid only when the count passes the
// streak's best ever, so a reset and climb back never pays one twice) -- half the dual-streak amounts (see
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
  // dayId and the timezone offsets an older app sends are ignored: the day
  // is the server's, in the streak's pinned zone (streakClock.js).
  const { timeZone, deckOnly } = req.body || {};

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
    const nowMs = Date.now();
    const { zone, update: tzUpdate } = pinZone(streak.tz, timeZone, nowMs);
    if (!zone) {
      res.status(200).json({ ok: true, closed: false, reason: 'no-timezone' });
      return;
    }
    if (tzUpdate) await streakRef.update({ tz: tzUpdate });
    const dayId = serverDay(zone, nowMs);

    const [checkinsSnap, fbSnap] = await Promise.all([
      db.collection('checkins').where('userId', '==', account.uid).get(),
      db.collection('pick_feedback').where('userId', '==', account.uid).get(),
    ]);
    // Today's 3 cards, drawn by the server once and stored (assignDeck), so
    // the phone shows them and only they count.
    const visitedIds = new Set(
      checkinsSnap.docs
        .map((d) => d.data())
        .filter((c) => (c.ratingOnly ? false : typeof c.visited === 'boolean' ? c.visited : c.points !== 0))
        .map((c) => canonicalLandmarkId(c.landmarkId, c.region))
    );
    const deck = () =>
      streak.cityId
        ? assignDeck(
            streakRef,
            dayId,
            () => pickDailyCardIds(account.uid, dayId, streak.cityId, visitedIds, undefined, answeredBeforeDay(fbSnap.docs, checkinsSnap.docs, zone, dayId)),
            streak.cityId
          )
        : Promise.resolve({ cards: [], cityId: null });
    if (deckOnly) {
      const d = await deck();
      res.status(200).json({ ok: true, dayId, cityId: d.cityId, cards: d.cards });
      return;
    }
    // Already closed for this day -- report the current state, no-op, no
    // points (a repeat call, e.g. a reload, must never double-award).
    if (streak.lastCompletedDay === dayId) {
      res.status(200).json({ ok: true, closed: true, already: true, dayId, count: streak.count, best: streak.best });
      return;
    }
    // A verified check-in today secures the day by itself; otherwise 3
    // different landmarks answered today (Travel Picks answers, ratings,
    // check-ins), all timed by the server.
    const checkedIn = hasVerifiedCheckinOnDay(checkinsSnap.docs, zone, dayId);
    const counted = checkedIn ? 0 : distinctActionsOnDay(fbSnap.docs, checkinsSnap.docs, zone, dayId);
    const picksDone = checkedIn || counted >= SOLO_PICK_VOTES_REQUIRED;

    // Otherwise the 3 daily cards: exactly the server's 3, each with a real
    // answer. (The old "any 3 ids rated in today's entry" fallback let a
    // phone close the day with made-up ids.)
    let cardsDone = false;
    if (!picksDone) {
      if (!streak.cityId) {
        res.status(200).json({ ok: true, closed: false, reason: 'no-city', dayId, counted, needed: SOLO_PICK_VOTES_REQUIRED });
        return;
      }
      const cardIds = (await deck()).cards;
      const entrySnap = await streakRef.collection('days').doc(dayId).collection('entries').doc(account.uid).get();
      const entry = entrySnap.exists ? entrySnap.data() : null;
      cardsDone = !!entry && cardIds.length > 0 && cardIds.every((id) => VERDICTS.has(entry.ratings?.[id]));
    }
    const done = cardsDone || picksDone;
    if (!done) {
      res.status(200).json({ ok: true, closed: false, dayId, counted, needed: SOLO_PICK_VOTES_REQUIRED });
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
      // Read before the update: past the best ever means a first time.
      const milestone = count > (fresh.best || 0) ? SOLO_MILESTONE_POINTS[count] || 0 : 0;
      t.update(streakRef, { count, best, lastCompletedDay: dayId, updatedAt: FieldValue.serverTimestamp() });
      // Paid in the same transaction as the close: a failed payout can no
      // longer leave the day closed with no points (a retry sees `already`).
      for (const [ref, data] of leaderboardPointWrites(db, account.uid, fresh.memberNames?.[account.uid], SOLO_DAY_POINTS + milestone, dayId)) {
        t.set(ref, data, { merge: true });
      }
      return { closed: true, count, best, milestone };
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
    const milestone = outcome.milestone;
    res.status(200).json({
      ok: true,
      closed: true,
      dayId,
      count: nextCount,
      best: nextBest,
      pointsAwarded: SOLO_DAY_POINTS,
      milestoneAwarded: milestone || null,
    });
  } catch (e) {
    console.error('[closeSoloStreakDay]', e);
    res.status(500).json({ error: 'Could not close that day.' });
  }
}

export default withCors(handler);
