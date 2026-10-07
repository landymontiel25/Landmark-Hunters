import { FieldValue } from 'firebase-admin/firestore';

// Admin-SDK equivalent of src/lib/leaderboard.js's periodKeys/
// awardLeaderboardPoints -- duplicated (not imported) for the same reason
// every other api/_lib file duplicates pure logic from src/lib: leaderboard.js
// chains into src/lib/firebase.js, which reads import.meta.env, a Vite-only
// construct that crashes a Vercel-bundled serverless function on load (see
// _lib/streakDay.js's own note on this).
function pad(n) {
  return String(n).padStart(2, '0');
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

function periodKeys(date = new Date()) {
  return {
    weekly: isoWeekKey(date),
    monthly: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    yearly: `${date.getFullYear()}`,
  };
}

function dateFromDayId(dayId) {
  const m = typeof dayId === 'string' && /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dayId);
  return m ? new Date(Number(m[1]), Number(m[2]), Number(m[3])) : new Date();
}

export { periodKeys };

// A display name from a client (or a doc a client once wrote) ends up on the
// public leaderboard: only a short non-empty string is kept, anything else
// (an object, a huge string) falls back to the app's usual 'A traveler'.
export function cleanUserName(name) {
  if (typeof name !== 'string') return 'A traveler';
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return 'A traveler';
  return trimmed;
}

const PERIODS = ['weekly', 'monthly', 'yearly'];

// Awarded server-side, from the same endpoint that decides a streak day
// actually closed, rather than the client self-reporting "I earned N
// points" after the fact -- avoids the double-call asymmetry a dual streak
// would otherwise hit (only ONE member's client gets `closed: true` back;
// the other's follow-up call sees `already: true` and would never trigger
// a client-side award), and keeps the same trust boundary close-streak-day.js
// already uses for the count itself.
export async function awardLeaderboardPointsServer(db, userId, userName, points, dayId) {
  if (!userId || !points) return;
  // dayId is the caller's own local "y-m-d" key (month 0-based, already
  // validated by validClientDayKey): derive the week/month/year from THAT so
  // points land in the same period the traveler's own check-ins do, not the
  // server's UTC one (which differs near midnight on a period boundary).
  const keys = periodKeys(dateFromDayId(dayId));
  const batch = db.batch();
  for (const period of PERIODS) {
    const ref = db.collection('leaderboard_entries').doc(`${period}_${keys[period]}_${userId}`);
    batch.set(
      ref,
      { userId, userName: cleanUserName(userName), period, periodKey: keys[period], points: FieldValue.increment(points), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
}
