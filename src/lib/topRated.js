import { mallsLast } from './maprRank/mallsLast.js';

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

// "Top Landmarks" (owner, 2026-11-04): every landmark in the list, best
// first, ordered by ratedScore above (Google's stars weighted by its review
// count, the app's own ratings where Google has none). Places with no rating
// follow in popularity order. Miami malls come last of all, however well they
// score (maprRank/mallsLast.js). An earlier version (2026-10-29) kept only the
// 14 or so places over a review bar; the owner wants the whole list.
export const TOP_CANDIDATES = 110;

// The places worth asking Google about: the most popular TOP_CANDIDATES by the
// catalog's own popularity, airports aside. popular(l) is the caller's
// popularity score.
export function topCandidates(landmarks, popular) {
  return landmarks
    .filter((l) => l && !(l.categories || []).includes('airports'))
    .sort((a, b) => popular(b) - popular(a) || a.name.localeCompare(b.name))
    .slice(0, TOP_CANDIDATES);
}

// landmarks: every place in the list. google: { [landmarkId]: { google:
// { rating, count } } }. ratings: the app's own { [landmarkId]: { avg, count } }.
export function topLandmarksOrder(landmarks, google, popular, ratings = {}) {
  const score = new Map(landmarks.map((l) => [l, ratedScore(l, google || {}, ratings || {})]));
  return mallsLast(
    [...landmarks].sort(
      (a, b) => (score.get(b) ?? -1) - (score.get(a) ?? -1) || popular(b) - popular(a) || a.name.localeCompare(b.name)
    )
  );
}
