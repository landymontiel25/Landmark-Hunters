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

const PERIODS = ['weekly', 'monthly', 'yearly'];

// Awarded server-side, from the same endpoint that decides a streak day
// actually closed, rather than the client self-reporting "I earned N
// points" after the fact -- avoids the double-call asymmetry a dual streak
// would otherwise hit (only ONE member's client gets `closed: true` back;
// the other's follow-up call sees `already: true` and would never trigger
// a client-side award), and keeps the same trust boundary close-streak-day.js
// already uses for the count itself.
export async function awardLeaderboardPointsServer(db, userId, userName, points) {
  if (!userId || !points) return;
  const keys = periodKeys();
  const batch = db.batch();
  for (const period of PERIODS) {
    const ref = db.collection('leaderboard_entries').doc(`${period}_${keys[period]}_${userId}`);
    batch.set(
      ref,
      { userId, userName: userName || 'A traveler', period, periodKey: keys[period], points: FieldValue.increment(points), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
}
