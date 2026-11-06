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

// "Top Landmarks" (owner, 2026-11-06): the number of Google reviews, most
// first ("we're going to go by the number of reviews per landmark"); Google's
// stars only break a tie. So Bayfront Park (21,895 reviews) is above Ball &
// Chain (10,138). No hand-typed score: the 0-10 `popularity` numbers in
// src/data had no source and tied 13 Miami places at 7, which then sorted A
// to Z (owner: "we should not be using that"). Places Google has no answer
// for follow, by the app's own ratings, then name. Miami malls come last of
// all (maprRank/mallsLast.js). Google's terms forbid storing its ratings, so
// the Landmarks tab fetches them live (useTopRatings.js) before it shows the
// list. Miami first (owner): it fits the lookup cap whole; bigger lists are
// still to do.
const googleOf = (google, l) => {
  const g = google?.[l.id]?.google;
  return g?.rating > 0 && g.count > 0 ? g : null;
};
// landmarks: every place in the list. google: { [landmarkId]: { google:
// { rating, count } } }. ratings: the app's own { [landmarkId]: { avg, count } }.
export function topLandmarksOrder(landmarks, google, ratings = {}) {
  const key = new Map(
    landmarks.map((l) => {
      const g = googleOf(google, l);
      const r = ratings?.[l.id];
      return [l, { g: g ? g.count : null, stars: g ? g.rating : 0, app: r?.count > 0 ? weightedStars(r.avg, r.count) : null }];
    })
  );
  const tier = (k) => (k.g != null ? 0 : k.app != null ? 1 : 2);
  return mallsLast(
    [...landmarks].sort((a, b) => {
      const ka = key.get(a);
      const kb = key.get(b);
      return tier(ka) - tier(kb) || (kb.g ?? 0) - (ka.g ?? 0) || kb.stars - ka.stars || (kb.app ?? 0) - (ka.app ?? 0) || a.name.localeCompare(b.name);
    })
  );
}

// Owner, 2026-11-05: Top Landmarks are places you would take a picture at.
// Restaurants and malls are not shown there; the Landmarks tab keeps them
// behind "Restaurants" and "Malls" tabs side by side under the list, and the Map sheet's
// Top landmarks button leaves them to its Eat and Shopping moods. A category
// chip you tap yourself (Food, say) still lists them.
export const isRestaurantOrMall = (l) => !!l && ((l.categories || []).includes('food') || isMallPlace(l));
