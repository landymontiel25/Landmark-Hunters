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

// "Top Landmarks" (owner, 2026-10-29): real top landmarks, not just well-rated
// places. A place's score is its Google rating times the log of its review
// count, so a 4.8 from 8,000 people beats a 4.6 from 2,000 (Pinecrest
// Gardens) and a 4.9 from 300. Places under a review bar are left out
// altogether (Gesu Catholic Church, 1,306 reviews, next to 8,000+ for the
// Miami leaders): the bar is a quarter of the biggest review count in the
// list, never under 200 or over 2,000 reviews.
export const TOP_CANDIDATES = 40;
export const TOP_BAR_MIN = 200;
export const TOP_BAR_MAX = 2000;
export const topScore = (rating, count) => rating * Math.log10(1 + count);
export const topReviewBar = (maxCount) => Math.min(TOP_BAR_MAX, Math.max(TOP_BAR_MIN, Math.round(0.25 * (Number(maxCount) || 0))));

// The places worth asking Google about: the most popular TOP_CANDIDATES by the
// catalog's own popularity, airports aside (they stay landmarks but are not
// "top" attractions). popular(l) is the caller's popularity score.
export function topCandidates(landmarks, popular) {
  return landmarks
    .filter((l) => l && !(l.categories || []).includes('airports'))
    .sort((a, b) => popular(b) - popular(a) || a.name.localeCompare(b.name))
    .slice(0, TOP_CANDIDATES);
}

// google: { [landmarkId]: { google: { rating, count } } }. Candidates that
// clear the bar, best score first. With no Google data at all (offline, or
// signed out) the candidates keep their popularity order.
export function topLandmarksOrder(candidates, google, popular) {
  const data = (l) => {
    const g = google?.[l.id]?.google;
    return g?.rating > 0 && g.count > 0 ? g : null;
  };
  const rated = candidates.filter(data);
  if (!rated.length) return candidates;
  const bar = topReviewBar(Math.max(...rated.map((l) => data(l).count)));
  return rated
    .filter((l) => data(l).count >= bar)
    .sort(
      (a, b) =>
        topScore(data(b).rating, data(b).count) - topScore(data(a).rating, data(a).count) ||
        popular(b) - popular(a) ||
        a.name.localeCompare(b.name)
    );
}
