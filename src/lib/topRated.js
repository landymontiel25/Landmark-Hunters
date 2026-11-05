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

// "Top Landmarks" (owner, 2026-11-05): every landmark in the list, the places
// the most people go to first. That is the catalog's popularity score (0-10,
// curated, set per place in src/data and the place packs) -- NOT the app's own
// check-in counts: with a few testers those said an Actors' Playhouse beat
// Ocean Drive (owner, 2026-11-05). Ties fall back to ratedScore above
// (Google's stars weighted by review count, the app's own ratings where
// Google has none), then name. Miami malls come last of all
// (maprRank/mallsLast.js). Earlier versions ordered by rating alone
// (2026-10-29: only the ~14 over a review bar; 2026-11-04: all by rating) and
// by the app's check-ins (2026-11-04).
export const popularityOf = (l) => Number(l?.popularity) || 0;
// landmarks: every place in the list. google: { [landmarkId]: { google:
// { rating, count } } }. ratings: the app's own { [landmarkId]: { avg, count } }.
export function topLandmarksOrder(landmarks, google, ratings = {}) {
  const score = new Map(landmarks.map((l) => [l, ratedScore(l, google || {}, ratings || {})]));
  return mallsLast(
    [...landmarks].sort(
      (a, b) =>
        popularityOf(b) - popularityOf(a) ||
        (score.get(b) ?? -1) - (score.get(a) ?? -1) ||
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
