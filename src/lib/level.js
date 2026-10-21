// A player's level, derived from lifetime points (not a period leaderboard
// score) so it only ever goes up. Level N unlocks at (N-1)^2 * 100 points
// (lifetime = bonusPoints + check-in points, getUserStats), so early levels
// come fast and later ones take meaningfully longer, the same shape most
// level curves use.
const POINTS_PER_LEVEL_UNIT = 100;

export function levelForPoints(totalPoints) {
  return Math.floor(Math.sqrt(Math.max(0, totalPoints) / POINTS_PER_LEVEL_UNIT)) + 1;
}

/**
 * Everything a level-progress bar needs: current level, the point range
 * that level spans, and how far into it you are (0-1).
 */
export function levelProgress(totalPoints) {
  const points = Math.max(0, totalPoints);
  const level = levelForPoints(points);
  const floor = (level - 1) ** 2 * POINTS_PER_LEVEL_UNIT;
  const ceil = level ** 2 * POINTS_PER_LEVEL_UNIT;
  const span = ceil - floor;
  return {
    level,
    pointsIntoLevel: points - floor,
    pointsForNextLevel: span,
    pct: span > 0 ? Math.min(1, (points - floor) / span) : 1,
  };
}
