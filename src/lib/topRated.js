import { mallsLast } from './maprRank/mallsLast.js';
import { isMallPlace } from './malls.js';

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

// "Top Landmarks" (owner, 2026-11-05): every landmark in the list, most
// visited first. A place's visits are the different people who have checked
// in there (the nightly job's mapr_models/signals.visits, "<region>/<id>").
// Ties, which is everything until people have checked in, fall back to
// ratedScore above (Google's stars weighted by review count, the app's own
// ratings where Google has none), then popularity. Places with no rating
// follow in popularity order. Miami malls come last of all
// (maprRank/mallsLast.js). Earlier versions ordered by rating alone
// (2026-10-29: only the ~14 over a review bar; 2026-11-04: all by rating).
export const visitsOf = (visits, l) => Number(visits?.[`${l.regionId || l.region}/${l.id}`]) || 0;
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

// landmarks: every place in the list. visits: { "<region>/<id>": people }. google: { [landmarkId]: { google:
// { rating, count } } }. ratings: the app's own { [landmarkId]: { avg, count } }.
export function topLandmarksOrder(landmarks, google, popular, ratings = {}, visits = {}) {
  const score = new Map(landmarks.map((l) => [l, ratedScore(l, google || {}, ratings || {})]));
  return mallsLast(
    [...landmarks].sort(
      (a, b) =>
        visitsOf(visits, b) - visitsOf(visits, a) ||
        (score.get(b) ?? -1) - (score.get(a) ?? -1) ||
        popular(b) - popular(a) ||
        a.name.localeCompare(b.name)
    )
  );
}

// Owner, 2026-11-05: Top Landmarks are places you would take a picture at.
// Restaurants and malls are not shown there; the Landmarks tab keeps them
// behind "Restaurants" and "Malls" tabs side by side under the list, and the Map sheet's
// Top landmarks button leaves them to its Eat and Shopping moods. A category
// chip you tap yourself (Food, say) still lists them.
export const isRestaurantOrMall = (l) => !!l && ((l.categories || []).includes('food') || isMallPlace(l));
