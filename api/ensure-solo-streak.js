import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { monthKey, previousDayKey, localDayKey } from './_lib/streakDay.js';
import { withCors } from './_lib/cors.js';
import { cleanUserName } from './_lib/leaderboardPoints.js';
import { pinZone, writtenAtMs } from './_lib/streakClock.js';

const PICKS_STREAK_THRESHOLD = 3;
export const SOLO_FREEZES_PER_MONTH = 1;

// Duplicated from leaderboard.js's isRealCheckin (pure logic, not worth
// pulling that whole client-Firebase-importing module in for -- see
// _lib/streakDay.js's comment on why that crashes a serverless function).
function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}

// Admin-SDK reimplementation of src/lib/streaks.js's dailyActionDayKeys/
// computeStreakDays/hasSecuredStreakToday -- the exact same algorithm that
// already computed a LIVE solo streak count from check-in/pick_feedback
// history before this endpoint existed. Duplicated rather than imported for
// the same reason as isRealCheckin above.
//
// Every "which calendar day does this timestamp fall on" decision goes
// through localDayKey(epochMs, timeZone) rather than reading the executing
// machine's own local time -- see that helper's own note on why: this code
// runs on Vercel (always UTC), but a "local calendar day" streak has to
// agree with the day the CLIENT (the traveler's own timezone) would compute
// for the same instant, or historical days silently land in the wrong
// bucket for anyone not in UTC.
function dailyActionDayKeys(checkins, pickFeedback, timeZone, minActions = PICKS_STREAK_THRESHOLD) {
  const idsByDay = new Map();
  const add = (key, id) => {
    if (!key || !id) return;
    if (!idsByDay.has(key)) idsByDay.set(key, new Set());
    idsByDay.get(key).add(id);
  };
  // A pick answer's day is when Firestore wrote it, never the `at` the
  // phone put in it (anti-farming item 2): backdated answers count for today.
  for (const snap of pickFeedback || []) {
    const f = typeof snap?.data === 'function' ? snap.data() : snap;
    const at = writtenAtMs(snap);
    if (!Number.isFinite(at) || !f?.landmarkId) continue;
    add(localDayKey(at, timeZone), f.landmarkId);
  }
  for (const c of checkins || []) {
    if (isRealCheckin(c) || !c.createdAt?.seconds || !c.landmarkId) continue;
    add(localDayKey(c.createdAt.seconds * 1000, timeZone), c.landmarkId);
  }
  const days = new Set();
  for (const [key, ids] of idsByDay) {
    if (ids.size >= minActions) days.add(key);
  }
  return days;
}

function computeStreakDays(checkins, now, pickFeedback, timeZone) {
  const days = new Set();
  for (const c of checkins) {
    if (!isRealCheckin(c)) continue;
    const sec = c.createdAt?.seconds;
    if (!sec) continue;
    days.add(localDayKey(sec * 1000, timeZone));
  }
  for (const key of dailyActionDayKeys(checkins, pickFeedback, timeZone)) days.add(key);
  if (days.size === 0) return 0;
  let cursor = localDayKey(now.getTime(), timeZone);
  if (!days.has(cursor)) {
    cursor = previousDayKey(cursor);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

function hasSecuredToday(checkins, pickFeedback, now, timeZone) {
  const today = localDayKey(now.getTime(), timeZone);
  const checkedIn = checkins.some(
    (c) => isRealCheckin(c) && c.createdAt?.seconds && localDayKey(c.createdAt.seconds * 1000, timeZone) === today
  );
  return checkedIn || dailyActionDayKeys(checkins, pickFeedback, timeZone).has(today);
}

// Solo streaks share the streaks/{id} collection with dual streaks now
// (mode: 'solo', memberIds: [uid], doc id is just the uid) -- this is the
// ONE place a solo streak doc gets created. Idempotent: an existing doc is
// just returned as-is. For a brand-new doc, it's seeded from the user's
// REAL check-in/pick_feedback history using the exact algorithm that used
// to compute a live count on every render (see above) -- so switching solo
// streaks from "derived live" to "a stored, server-authority doc" (needed
// for freezes to mean anything) never resets anyone's count. This lazy,
// per-user seed on first touch IS the entire migration: there is no batch
// job run against every user's data at once, and nothing here can ever
// reset an already-created doc.
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
  if (isRateLimited(req, 'ensure-solo-streak', { limit: 20, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { userName, timeZone } = req.body || {};

  try {
    const db = adminDb();
    const ref = db.collection('streaks').doc(account.uid);
    const snap = await ref.get();

    // Re-derive {count, best, lastCompletedDay} from real check-in/
    // pick_feedback history, the same way for both a brand-new doc and a
    // repair of an existing one below.
    const seedFromHistory = async () => {
      const [checkinsSnap, feedbackSnap] = await Promise.all([
        db.collection('checkins').where('userId', '==', account.uid).get(),
        db.collection('pick_feedback').where('userId', '==', account.uid).get(),
      ]);
      const checkins = checkinsSnap.docs.map((d) => d.data());
      const pickFeedback = feedbackSnap.docs;
      const now = new Date();
      const count = computeStreakDays(checkins, now, pickFeedback, timeZone);
      const today = localDayKey(now.getTime(), timeZone);
      // A day already secured today counts toward the seeded value above, so
      // today itself is the anchor; otherwise (streak > 0 but not yet
      // secured today) yesterday is, so the very first close-solo-streak-day
      // call under the new system correctly bridges forward from the seeded
      // count instead of treating it as a break.
      const securedToday = hasSecuredToday(checkins, pickFeedback, now, timeZone);
      const lastCompletedDay = count === 0 ? null : securedToday ? today : previousDayKey(today);
      return { count, lastCompletedDay };
    };

    // An existing streak is returned as it is: only a day-close moves it.
    // (Until 2026-11-23 every call re-seeded it from history "upward only",
    // and that history trusted the phone's own answer times, so backdated
    // answers could raise a stored streak. Removed, anti-farming item 2.)
    // The only thing a call may change is the pinned time zone (travel),
    // and at most once a day (streakClock.js pinZone).
    if (snap.exists) {
      const existing = snap.data();
      const { update: tzUpdate } = pinZone(existing.tz, timeZone);
      if (tzUpdate) await ref.update({ tz: tzUpdate });
      res.status(200).json({ id: account.uid, ...existing, ...(tzUpdate ? { tz: tzUpdate } : {}) });
      return;
    }
    const { count: seededCount, lastCompletedDay } = await seedFromHistory();
    const data = {
      mode: 'solo',
      memberIds: [account.uid],
      memberNames: { [account.uid]: cleanUserName(userName) },
      cityId: null,
      count: seededCount,
      // No historical "best" was ever tracked for the old live-computed
      // solo streak -- best starts equal to the seeded current count
      // rather than a made-up number.
      best: seededCount,
      lastCompletedDay,
      freezesLeft: SOLO_FREEZES_PER_MONTH,
      freezeMonth: monthKey(new Date()),
      frozenDays: [],
      ...(pinZone(null, timeZone).update ? { tz: pinZone(null, timeZone).update } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    // create-if-missing: Header and the Streaks page both call this on first
    // load; a plain set() let the slower call overwrite a doc a close-day call
    // had already advanced in between.
    try {
      await db.runTransaction(async (t) => {
        if ((await t.get(ref)).exists) throw Object.assign(new Error('exists'), { alreadyExists: true });
        t.set(ref, data);
      });
    } catch (e) {
      if (!e?.alreadyExists) throw e;
      const winner = await ref.get();
      res.status(200).json({ id: account.uid, ...winner.data() });
      return;
    }
    res.status(200).json({ id: account.uid, ...data });
  } catch (e) {
    console.error('[ensure-solo-streak]', e);
    res.status(500).json({ error: 'Could not load your streak.' });
  }
}

export default withCors(handler);
