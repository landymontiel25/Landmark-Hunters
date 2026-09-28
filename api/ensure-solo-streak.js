import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKey, monthKey, previousDayKey } from './_lib/streakDay.js';

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
function dailyActionDayKeys(checkins, pickFeedback, minActions = PICKS_STREAK_THRESHOLD) {
  const idsByDay = new Map();
  const add = (key, id) => {
    if (!key || !id) return;
    if (!idsByDay.has(key)) idsByDay.set(key, new Set());
    idsByDay.get(key).add(id);
  };
  for (const f of pickFeedback || []) {
    if (!f.at || !f.landmarkId) continue;
    add(dayKey(new Date(f.at)), f.landmarkId);
  }
  for (const c of checkins || []) {
    if (isRealCheckin(c) || !c.createdAt?.seconds || !c.landmarkId) continue;
    add(dayKey(new Date(c.createdAt.seconds * 1000)), c.landmarkId);
  }
  const days = new Set();
  for (const [key, ids] of idsByDay) {
    if (ids.size >= minActions) days.add(key);
  }
  return days;
}

function computeStreakDays(checkins, now, pickFeedback) {
  const days = new Set();
  for (const c of checkins) {
    if (!isRealCheckin(c)) continue;
    const sec = c.createdAt?.seconds;
    if (!sec) continue;
    days.add(dayKey(new Date(sec * 1000)));
  }
  for (const key of dailyActionDayKeys(checkins, pickFeedback)) days.add(key);
  if (days.size === 0) return 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function hasSecuredToday(checkins, pickFeedback, now) {
  const today = dayKey(now);
  const checkedIn = checkins.some(
    (c) => isRealCheckin(c) && c.createdAt?.seconds && dayKey(new Date(c.createdAt.seconds * 1000)) === today
  );
  return checkedIn || dailyActionDayKeys(checkins, pickFeedback).has(today);
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
  if (isRateLimited(req, 'ensure-solo-streak', { limit: 20, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { userName } = req.body || {};

  try {
    const db = adminDb();
    const ref = db.collection('streaks').doc(account.uid);
    const snap = await ref.get();
    if (snap.exists) {
      res.status(200).json({ id: account.uid, ...snap.data() });
      return;
    }

    const [checkinsSnap, feedbackSnap] = await Promise.all([
      db.collection('checkins').where('userId', '==', account.uid).get(),
      db.collection('pick_feedback').where('userId', '==', account.uid).get(),
    ]);
    const checkins = checkinsSnap.docs.map((d) => d.data());
    const pickFeedback = feedbackSnap.docs.map((d) => d.data());
    const now = new Date();
    const seededCount = computeStreakDays(checkins, now, pickFeedback);
    const today = dayKey(now);
    // A day already secured today counts toward the seeded value above, so
    // today itself is the anchor; otherwise (streak > 0 but not yet
    // secured today) yesterday is, so the very first close-solo-streak-day
    // call under the new system correctly bridges forward from the seeded
    // count instead of treating it as a break.
    const securedToday = hasSecuredToday(checkins, pickFeedback, now);
    const lastCompletedDay = seededCount === 0 ? null : securedToday ? today : previousDayKey(today);

    const data = {
      mode: 'solo',
      memberIds: [account.uid],
      memberNames: { [account.uid]: userName || 'A traveler' },
      cityId: null,
      count: seededCount,
      // No historical "best" was ever tracked for the old live-computed
      // solo streak -- best starts equal to the seeded current count
      // rather than a made-up number.
      best: seededCount,
      lastCompletedDay,
      freezesLeft: SOLO_FREEZES_PER_MONTH,
      freezeMonth: monthKey(now),
      frozenDays: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    res.status(200).json({ id: account.uid, ...data });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not load your streak.' });
  }
}
