// What counts as a real visit, pure, so the app (leaderboard.js, streaks,
// galleries, friend stats, Mapr ratings) and the API
// (api/regional-leaderboard.js) agree. Check-ins carry explicit `visited` /
// `ratingOnly` fields; data written before those existed falls back to the
// old points rule, which was right for that data.
export function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}
