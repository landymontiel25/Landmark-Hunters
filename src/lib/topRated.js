import { mallsLast } from './maprRank/mallsLast.js';
import { isMallPlace } from './malls.js';

// "Top Rated" (owner, 2026-10-18): Google's rating weighted by its review
// count, so 5.0 from 2 reviews can't beat 4.8 from 103. Google only. Google's terms forbid storing its ratings, so
// they're fetched live for this visit only (the Landmarks tab caps how many a visit).
export const RATED_PRIOR_COUNT = 20;
const RATED_PRIOR_STARS = 4;
export const weightedStars = (stars, count) => (count * stars + RATED_PRIOR_COUNT * RATED_PRIOR_STARS) / (count + RATED_PRIOR_COUNT);
// Google only (owner, 2026-11-08: "it should completely be only google
// reviews"): the app's own ratings and check-ins never count. null when
// Google has no rating for the place.
export function ratedScore(l, googleById) {
  const g = googleById?.[l.id]?.google;
  return g?.rating > 0 && g.count > 0 ? weightedStars(g.rating, g.count) : null;
}

// "Top Landmarks" (owner, 2026-11-06): the number of Google reviews, most
// first ("we're going to go by the number of reviews per landmark"); Google's
// stars only break a tie. So Bayfront Park (21,895 reviews) is above Ball &
// Chain (10,138). No hand-typed score: the 0-10 `popularity` numbers in
// src/data had no source and tied 13 Miami places at 7, which then sorted A
// to Z (owner: "we should not be using that"). Places Google has no answer
// for follow, A to Z. Miami malls come last of
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
// Google only (owner, 2026-11-08): the app's own ratings and check-ins
// never move a place; places Google has no rating for follow, A to Z.
export function topLandmarksOrder(landmarks, google) {
  const key = new Map(
    landmarks.map((l) => {
      const g = googleOf(google, l);
      return [l, { g: g ? g.count : null, stars: g ? g.rating : 0 }];
    })
  );
  const tier = (k) => (k.g != null ? 0 : 1);
  return mallsLast(
    [...landmarks].sort((a, b) => {
      const ka = key.get(a);
      const kb = key.get(b);
      return tier(ka) - tier(kb) || (kb.g ?? 0) - (ka.g ?? 0) || kb.stars - ka.stars || a.name.localeCompare(b.name);
    })
  );
}

// Owner, 2026-11-05: Top Landmarks are places you would take a picture at.
// Restaurants and malls are not shown there; the Landmarks tab keeps them
// behind "Restaurants" and "Malls" tabs side by side under the list, and the Map sheet's
// Top landmarks button leaves them to its Eat and Shopping moods. A category
// chip you tap yourself (Food, say) still lists them.
export const isRestaurantOrMall = (l) => !!l && ((l.categories || []).includes('food') || isMallPlace(l));
