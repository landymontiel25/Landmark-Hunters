import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { PICKS_STREAK_THRESHOLD, previousDayKey } from './_lib/streakDay.js';

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

export default async function handler(req, res) {
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
  if (!pairId || typeof pairId !== 'string' || !dayId || typeof dayId !== 'string') {
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

    const entriesSnap = await streakRef.collection('days').doc(dayId).collection('entries').get();
    const entries = Object.fromEntries(entriesSnap.docs.map((d) => [d.id, d.data()]));
    const bothDone = (streak.memberIds || []).every(
      (uid) => entries[uid]?.done && (entries[uid]?.count || 0) >= PICKS_STREAK_THRESHOLD
    );
    if (!bothDone) {
      res.status(200).json({ ok: true, closed: false });
      return;
    }

    // A frozen day (item 5, api/use-streak-freeze.js) bridges one gap the
    // same as an actually-completed day would -- it holds the count, it
    // doesn't add to it.
    const bridged =
      streak.lastCompletedDay === previousDayKey(dayId) || (streak.frozenDays || []).includes(previousDayKey(dayId));
    const broke = !bridged && (streak.count || 0) > 0;
    const nextCount = bridged ? (streak.count || 0) + 1 : 1;
    const nextBest = Math.max(streak.best || 0, nextCount);
    const update = {
      count: nextCount,
      best: nextBest,
      lastCompletedDay: dayId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Recovery mission (item 7): only opens when a real break just happened
    // AND the pair has no freezes left to fall back on. 24h window, logged
    // reactively here (there's no scheduled cron yet to catch a break that
    // nobody's client happens to trigger a close around).
    if (broke && (streak.freezesLeft || 0) <= 0) {
      update.recoveryOpenUntil = Date.now() + 24 * 60 * 60 * 1000;
      update.recoveryPriorCount = streak.count || 0;
    }
    await streakRef.update(update);
    res.status(200).json({ ok: true, closed: true, count: nextCount, best: nextBest });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not close that day.' });
  }
}
