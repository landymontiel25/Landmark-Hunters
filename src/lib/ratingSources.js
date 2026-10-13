// Outside ratings on landmarks (docs/ratings.md): which sources exist, the
// switches that turn parts on and off, and small shared helpers. Pure, no
// Firebase imports, so the server (api/landmark-ratings.js) reads it too.

// The sources the endpoint asks, in display order. Each one needs its own
// ID per landmark (src/data/ratingSourceIds.json, filled by
// scripts/match-rating-sources.mjs) and its own server key.
export const OUTSIDE_SOURCES = ['google', 'tripadvisor'];

export const SOURCE_LABELS = {
  google: 'Google Maps',
  tripadvisor: 'Tripadvisor',
  landmarkHunters: 'Landmark Hunters',
};

export const RATINGS_FLAGS = {
  // The one-line ratings on each landmark card (Landmarks tab). Every card
  // that scrolls into view costs one call per source, and the terms forbid
  // caching ratings, so this is the switch to turn off if billing climbs.
  cardLine: true,
  // The Landmark Hunters row in the detail screen's Ratings section (the
  // app's own landmark_ratings average). Off until the owner turns it on.
  landmarkHunters: false,
};

// Short review quotes per source on the detail screen.
export const MAX_SNIPPETS = 2;
export const SNIPPET_MAX_CHARS = 220;

// Tripadvisor only lets a partner quote a 5-bubble review, and only when the
// place's overall rating is at least 4 (its Display Requirements).
export const TRIPADVISOR_QUOTE_MIN_OVERALL = 4;

// "1,234" for review counts.
export function formatCount(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '';
}

// The key a landmark's IDs are stored under: "region/id".
export function ratingKey(regionId, landmarkId) {
  return regionId && landmarkId ? `${regionId}/${landmarkId}` : null;
}

// Cut a review to SNIPPET_MAX_CHARS on a word boundary, with an ellipsis.
export function trimSnippet(text, max = SNIPPET_MAX_CHARS) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// True when a source result has something to show.
export const hasRating = (r) => !!r && Number.isFinite(r.rating) && Number.isFinite(r.count) && r.count > 0;
