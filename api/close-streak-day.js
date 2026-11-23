import { verifyIdToken } from './_lib/verifyAuth.js';
import { pointsAppCheckGate } from './_lib/appCheck.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { previousDayKey, isDayBefore, monthKeyOfDay, monthKey } from './_lib/streakDay.js';
import { pinZone, serverDay, hasVerifiedCheckinOnDay, assignDeck } from './_lib/streakClock.js';
import { pickDailyCardIds } from '../src/lib/sharedDeck.js';
import { canonicalLandmarkId } from '../src/data/regions.js';
import { sendPushToUser } from './_lib/push.js';
import { computeCompatibilityServer } from './_lib/compatibility.js';
import { leaderboardPointWrites } from './_lib/leaderboardPoints.js';
import { withCors } from './_lib/cors.js';

// Points for a secured dual day, and one-time bonuses the first time a
// streak reaches a milestone length (paid only when the count passes the
// streak's best ever, so a reset and climb back never pays one twice) -- double the solo-streak amounts (see
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

const VERDICTS = new Set(['yes', 'no', 'unsure']);

// How many of a member's guesses match what the partner really rated that
// day (each partner's own entry), scored here, never by a phone.
export function scoreGuesses(cardIds, guesser, partner) {
  let right = 0;
  for (const id of cardIds) {
    const g = guesser?.guesses?.[id];
    const r = partner?.ratings?.[id];
    if (VERDICTS.has(g) && VERDICTS.has(r) && g === r) right += 1;
  }
  return right;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // App Check on every endpoint that pays points (item 5; APP_CHECK_POINTS_MODE).
  if (!(await pointsAppCheckGate(req, res, 'close-streak-day'))) return;
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'close-streak-day', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  // The phone's dayId is ignored (anti-farming item 2): the day is the
  // server's, in the pair's pinned time zone (streakClock.js).
  const { pairId, timeZone, deckOnly } = req.body || {};
  if (!pairId || typeof pairId !== 'string' || !/^[\w-]{1,128}$/.test(pairId)) {
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
    // A solo streak's doc id is the uid, so it could be passed as a pairId;
    // only pair streaks belong here (an old pair doc may predate `mode`).
    if (streak.mode === 'solo' || !(streak.memberIds || []).includes(account.uid)) {
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
    // Already closed for this day -- report the current state, no-op.
    if (streak.lastCompletedDay === dayId && !deckOnly) {
      res.status(200).json({ ok: true, closed: true, dayId, count: streak.count, best: streak.best, already: true });
      return;
    }

    if (!streak.cityId) {
      res.status(200).json({ ok: true, closed: false, dayId, reason: 'no-city', cards: [] });
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
      checkinsByMember.flatMap((snap) =>
        snap.docs
          .map((d) => d.data())
          .filter(isRealCheckin)
          // Same ids the phone excludes (getUserCheckedInLandmarkIds), or a
          // legacy-id check-in leaves the two decks different for good.
          .map((c) => canonicalLandmarkId(c.landmarkId, c.region))
      )
    );
    // Drawn once by the server and stored for the day (the phone shows these).
    const deck = await assignDeck(streakRef, dayId, () => pickDailyCardIds(pairId, dayId, streak.cityId, visitedIds), streak.cityId);
    const cardIds = deck.cards;
    if (deckOnly) {
      res.status(200).json({ ok: true, dayId, cityId: deck.cityId, cards: cardIds });
      return;
    }
    const entriesSnap = await streakRef.collection('days').doc(dayId).collection('entries').get();
    const entries = Object.fromEntries(entriesSnap.docs.map((d) => [d.id, d.data()]));

    // Notify the partner the moment THIS caller's own 3 are rated + guessed
    // -- independent of bothDone below (the day only closes once BOTH
    // members finish, but the partner should hear about it as soon as
    // their half is done, not wait on their own). Guarded by a flag on the
    // caller's own entry doc so a repeat call (page reload, a second close
    // attempt after the day's already closed) never double-sends.
    const myEntry = entries[account.uid];
    const answered = (e) => !!e && cardIds.length > 0 && cardIds.every((id) => VERDICTS.has(e.ratings?.[id]) && VERDICTS.has(e.guesses?.[id]));
    const myDone = answered(myEntry);
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

    const bothDone = cardIds.length > 0 && (streak.memberIds || []).every((uid) => answered(entries[uid]));
    if (!bothDone) {
      res.status(200).json({ ok: true, closed: false, dayId });
      return;
    }
    // A pair's day needs at least one real, server-verified visit that day,
    // by either member: two accounts can't keep a streak (and its points)
    // going from a couch.
    const visitedToday = checkinsByMember.some((snap) => hasVerifiedCheckinOnDay(snap.docs, zone, dayId));
    if (!visitedToday) {
      res.status(200).json({ ok: true, closed: false, dayId, reason: 'needs-verified-checkin' });
      return;
    }
    // Each member's guesses scored against what the other really rated.
    const [a, b] = streak.memberIds || [];
    const scores = { [a]: scoreGuesses(cardIds, entries[a], entries[b]), [b]: scoreGuesses(cardIds, entries[b], entries[a]) };

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
      // Past the best ever means a first time: a reset and climb back never
      // pays a milestone twice.
      const milestone = count > (fresh.best || 0) ? DUAL_MILESTONE_POINTS[count] || 0 : 0;
      const update = { count, best, lastCompletedDay: dayId, updatedAt: FieldValue.serverTimestamp() };
      // Recovery mission (item 7): only opens when a real break just happened
      // AND the pair has no freezes left to fall back on. 24h window, logged
      // reactively here (there's no scheduled cron yet to catch a break that
      // nobody's client happens to trigger a close around).
      // freezesLeft is only refreshed when someone touches freezes (see
      // use-streak-freeze.js), so a stored 0 from last month really means a
      // fresh allowance this month -- don't open a recovery mission then.
      const freezesNow = fresh.freezeMonth === monthKeyOfDay(dayId) ? fresh.freezesLeft ?? 0 : 2;
      // Once a month: complete-recovery-mission.js refuses a second one in the
      // same month (its own monthKey(new Date())), so don't open one it can't
      // ever complete.
      if (broke && freezesNow <= 0 && fresh.recoveryUsedMonth !== monthKey(new Date())) {
        update.recoveryOpenUntil = Date.now() + 24 * 60 * 60 * 1000;
        update.recoveryPriorCount = fresh.count || 0;
      }
      t.update(streakRef, update);
      t.set(streakRef.collection('days').doc(dayId), { scores, scoredAtMs: Date.now() }, { merge: true });
      // Both members are paid in the same transaction as the close, so a
      // failed payout can't leave the day closed with no points.
      for (const uid of fresh.memberIds || []) {
        for (const [ref, data] of leaderboardPointWrites(db, uid, fresh.memberNames?.[uid], DUAL_DAY_POINTS + milestone, dayId)) {
          t.set(ref, data, { merge: true });
        }
      }
      return { closed: true, count, best, scores };
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
    res.status(200).json({ ok: true, closed: true, dayId, count: nextCount, best: nextBest, scores: outcome.scores });
  } catch (e) {
    console.error('[close-streak-day]', e);
    res.status(500).json({ error: 'Could not close that day.' });
  }
}

export default withCors(handler);
