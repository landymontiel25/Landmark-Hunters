import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { previousDayKey, validClientDayKey, isDayBefore, monthKeyOfDay } from './_lib/streakDay.js';
import { pickDailyCardIds } from '../src/lib/sharedDeck.js';
import { sendPushToUser } from './_lib/push.js';
import { computeCompatibilityServer } from './_lib/compatibility.js';
import { awardLeaderboardPointsServer } from './_lib/leaderboardPoints.js';
import { withCors } from './_lib/cors.js';

// Points for a secured dual day, and one-time bonuses the first time a
// streak reaches a milestone length -- double the solo-streak amounts (see
// close-solo-streak-day.js), since a dual day requires coordinating a
// partner through rate AND guess on all 3, not just rating them alone.
// Awarded to BOTH members here (server-side, the moment the day actually
// closes) rather than left for each member's own client to self-report --
// only ONE member's client ever gets `closed: true` back (the other's
// follow-up call sees `already: true`), so a client-side award would only
// ever pay the first person to trigger the close.
export const DUAL_DAY_POINTS = 50;
export const DUAL_MILESTONE_POINTS = { 3: 200, 7: 600, 30: 2000 };

// Duplicated from leaderboard.js's isRealCheckin (pure logic, not worth
// pulling that whole client-Firebase-importing module in for -- see
// _lib/streakDay.js's comment on why that crashes a serverless function).
function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}

// The one place a pair's streak count actually moves. Called by either
// member's client right after they hit today's quota (see
// usePairStreakSync.js) -- not on a schedule -- but it never trusts what
// the CALLER claims about either member: it re-reads both entries straight
// from Firestore and decides for itself. That's a deliberate simplification
// of the full spec (item 3 wants a scheduled Vercel Cron closing days past
// each member's local midnight, so a pair with one member offline all day
// still gets closed correctly); this MVP only closes a day when someone is
// actively using the app to trigger the check, which is the common case but
// not the guaranteed one. A scheduled cron is a clean follow-up once this
// is proven out -- the data model doesn't change either way.

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
  if (isRateLimited(req, 'close-streak-day', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { pairId, dayId } = req.body || {};
  if (!pairId || typeof pairId !== 'string' || !validClientDayKey(dayId)) {
    res.status(400).json({ error: 'pairId and dayId are required.' });
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
    if (!(streak.memberIds || []).includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }
    // Already closed for this day -- report the current state, no-op.
    if (streak.lastCompletedDay === dayId) {
      res.status(200).json({ ok: true, closed: true, count: streak.count, best: streak.best, already: true });
      return;
    }

    if (!streak.cityId) {
      res.status(200).json({ ok: true, closed: false, reason: 'no-city' });
      return;
    }
    // Never trust a bare `done` flag -- re-derive today's real 3 cards the
    // exact same deterministic way both clients did (sharedDeck.js,
    // excluding anywhere either member has really checked into) and check
    // each member's entry actually covers all of them.
    const checkinsByMember = await Promise.all(
      (streak.memberIds || []).map((uid) => db.collection('checkins').where('userId', '==', uid).get())
    );
    const visitedIds = new Set(
      checkinsByMember.flatMap((snap) => snap.docs.map((d) => d.data()).filter(isRealCheckin).map((c) => c.landmarkId))
    );
    const cardIds = pickDailyCardIds(pairId, dayId, streak.cityId, visitedIds);
    const entriesSnap = await streakRef.collection('days').doc(dayId).collection('entries').get();
    const entries = Object.fromEntries(entriesSnap.docs.map((d) => [d.id, d.data()]));

    // Notify the partner the moment THIS caller's own 3 are rated + guessed
    // -- independent of bothDone below (the day only closes once BOTH
    // members finish, but the partner should hear about it as soon as
    // their half is done, not wait on their own). Guarded by a flag on the
    // caller's own entry doc so a repeat call (page reload, a second close
    // attempt after the day's already closed) never double-sends.
    const myEntry = entries[account.uid];
    const myDone = myEntry && cardIds.length > 0 && cardIds.every((id) => myEntry.ratings?.[id] && myEntry.guesses?.[id]);
    const partnerUid = (streak.memberIds || []).find((uid) => uid !== account.uid);
    if (myDone && !myEntry.notifiedPartner && partnerUid) {
      const myName = streak.memberNames?.[account.uid] || 'Your streak partner';
      const compat = await computeCompatibilityServer(account.uid, partnerUid).catch(() => null);
      const body =
        compat?.score != null
          ? `${myName} rated and guessed all 3 today -- your compatibility: ${Math.round(compat.score * 100)}% match.`
          : `${myName} rated and guessed all 3 today -- your turn!`;
      await sendPushToUser(partnerUid, {
        title: `\u{1F525} ${myName} finished today's 3`,
        body,
        data: { type: 'streak-partner-done', pairId },
      }).catch(() => {});
      await streakRef
        .collection('days')
        .doc(dayId)
        .collection('entries')
        .doc(account.uid)
        .set({ notifiedPartner: true }, { merge: true })
        .catch(() => {});
    }

    const bothDone =
      cardIds.length > 0 &&
      (streak.memberIds || []).every((uid) => {
        const e = entries[uid];
        return e && cardIds.every((id) => e.ratings?.[id] && e.guesses?.[id]);
      });
    if (!bothDone) {
      res.status(200).json({ ok: true, closed: false });
      return;
    }

    // Re-read and write inside a transaction: both partners' clients call this
    // the moment they finish, and when they finish together both used to read
    // the same pre-close count, both write it, and both pay out the day.
    const outcome = await db.runTransaction(async (t) => {
      const fresh = (await t.get(streakRef)).data() || streak;
      if (fresh.lastCompletedDay === dayId) {
        return { already: true, count: fresh.count, best: fresh.best };
      }
      // Never move lastCompletedDay backwards (e.g. a late call for yesterday).
      if (fresh.lastCompletedDay && isDayBefore(dayId, fresh.lastCompletedDay)) {
        return { stale: true };
      }
      // A frozen day (item 5, api/use-streak-freeze.js) bridges one gap the
      // same as an actually-completed day would -- it holds the count, it
      // doesn't add to it.
      const bridged =
        fresh.lastCompletedDay === previousDayKey(dayId) || (fresh.frozenDays || []).includes(previousDayKey(dayId));
      const broke = !bridged && (fresh.count || 0) > 0;
      const count = bridged ? (fresh.count || 0) + 1 : 1;
      const best = Math.max(fresh.best || 0, count);
      const update = { count, best, lastCompletedDay: dayId, updatedAt: FieldValue.serverTimestamp() };
      // Recovery mission (item 7): only opens when a real break just happened
      // AND the pair has no freezes left to fall back on. 24h window, logged
      // reactively here (there's no scheduled cron yet to catch a break that
      // nobody's client happens to trigger a close around).
      // freezesLeft is only refreshed when someone touches freezes (see
      // use-streak-freeze.js), so a stored 0 from last month really means a
      // fresh allowance this month -- don't open a recovery mission then.
      const freezesNow = fresh.freezeMonth === monthKeyOfDay(dayId) ? fresh.freezesLeft ?? 0 : 2;
      if (broke && freezesNow <= 0) {
        update.recoveryOpenUntil = Date.now() + 24 * 60 * 60 * 1000;
        update.recoveryPriorCount = fresh.count || 0;
      }
      t.update(streakRef, update);
      return { closed: true, count, best };
    });
    if (outcome.already) {
      res.status(200).json({ ok: true, closed: true, count: outcome.count, best: outcome.best, already: true });
      return;
    }
    if (outcome.stale) {
      res.status(200).json({ ok: true, closed: false, reason: 'stale-day' });
      return;
    }
    const nextCount = outcome.count;
    const nextBest = outcome.best;
    const milestone = DUAL_MILESTONE_POINTS[nextCount] || 0;
    await Promise.all(
      (streak.memberIds || []).map((uid) =>
        awardLeaderboardPointsServer(db, uid, streak.memberNames?.[uid], DUAL_DAY_POINTS + milestone, dayId)
      )
    );
    res.status(200).json({ ok: true, closed: true, count: nextCount, best: nextBest });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not close that day.' });
  }
}

export default withCors(handler);
