// "Top Rated" (owner, 2026-10-18: replaces Popular): Google's rating weighted
// by its review count, so 5.0 from 2 reviews can't beat 4.8 from 103. The
// app's own ratings stand in where Google has none; unrated places follow,
// in the old Popular order. Google's terms forbid storing its ratings, so
// they're fetched live for this visit only (the Landmarks tab caps how many a visit).
export const RATED_PRIOR_COUNT = 20;
const RATED_PRIOR_STARS = 4;
export const weightedStars = (stars, count) => (count * stars + RATED_PRIOR_COUNT * RATED_PRIOR_STARS) / (count + RATED_PRIOR_COUNT);
export function ratedScore(l, googleById, ratings) {
  const g = googleById[l.id]?.google;
  if (g?.rating > 0 && g.count > 0) return weightedStars(g.rating, g.count);
  const r = ratings[l.id];
  return r?.count > 0 ? weightedStars(r.avg, r.count) : null;
}
