// Places with stores inside them (a mall, a strip mall), for the Test tab's
// mall lab (screens/MallLab.jsx). Pure functions; nothing here touches the
// live catalog, Firestore or a real user's taste.
//
// A place can have a parent (`parentId`); a place that other places point to
// is a mall. After a visit the user says which stores they went into, then
// gives each a thumbs up or down (at most MAX_STORE_RATINGS per visit). Each
// vote moves the user's score on the store's tags with the same step, cap and
// decay as a Mapr Pick vote (tagScores.js applyRating with VOTE_DELTAS: +4 up,
// -6 down, half after 5 ratings on a tag, 90-day half-life, clamped to +/-100).
import { applyRating, VOTE_DELTAS } from './tagScores.js';

export const MAX_STORE_RATINGS = 4;
// Optional tags a rating can carry.
export const STORE_RATING_TAGS = ['good deals', 'friendly staff', 'clean', 'quick service', 'would go back'];
// How many of the user's best tags count as "top tags" for itineraries, and
// how many stores have to match them for the mall to join an itinerary.
export const TOP_TAG_COUNT = 5;
export const MIN_MATCHING_STORES = 2;

export const childrenOf = (parentId, places) => places.filter((p) => p.parentId === parentId);
export const isMall = (place, places) => places.some((p) => p.parentId === place.id);

// "Which stores did you visit?": every store, the most visited first.
export const storesByVisits = (parentId, places) =>
  childrenOf(parentId, places).sort((a, b) => (b.visits || 0) - (a.visits || 0) || a.name.localeCompare(b.name));

// The checked stores that get a rating card this visit (the first four).
export const ratingQueue = (checkedIds, places) =>
  checkedIds.map((id) => places.find((p) => p.id === id)).filter(Boolean).slice(0, MAX_STORE_RATINGS);

// One saved rating: who, which store (and its mall), the vote, the date, and
// any optional tags.
export const makeStoreRating = ({ userId, store, vote, tags = [], at = new Date() }) => ({
  userId,
  storeId: store.id,
  parentId: store.parentId || null,
  vote, // 'up' | 'down'
  date: at.toISOString(),
  tags: tags.filter((t) => STORE_RATING_TAGS.includes(t)),
});

// A vote applied to the user's taste ({ scores, at, counts } per tag).
export function applyStoreVote(taste, store, vote, nowMs = Date.now()) {
  const next = applyRating(taste, store.tags, null, nowMs, null, 1, VOTE_DELTAS[vote === 'up' ? 'yes' : 'no']);
  return {
    scores: { ...taste.scores, ...next.scores },
    at: { ...taste.at, ...next.at },
    counts: { ...taste.counts, ...next.counts },
  };
}

// The mall's score: each rated store's share of thumbs up (0..1), averaged
// with each store weighted by its visits. Stores nobody rated are skipped;
// null when none is rated.
export function mallScore(parentId, places, ratings) {
  let sum = 0;
  let weight = 0;
  for (const store of childrenOf(parentId, places)) {
    const mine = ratings.filter((r) => r.storeId === store.id);
    if (!mine.length) continue;
    const share = mine.filter((r) => r.vote === 'up').length / mine.length;
    const w = Math.max(1, store.visits || 0);
    sum += share * w;
    weight += w;
  }
  return weight ? sum / weight : null;
}

// The user's top tags: the highest positive scores.
export const topTags = (scores = {}, n = TOP_TAG_COUNT) =>
  Object.entries(scores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);

const listNames = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Itineraries: the mall joins only when MIN_MATCHING_STORES or more of its
// stores share a tag with the user's top tags; those stores are the reason.
// Returns { include, stores, reason }.
export function mallForItinerary(parentId, places, scores) {
  const top = topTags(scores);
  const rank = (tag) => top.indexOf(tag);
  const stores = childrenOf(parentId, places)
    .map((s) => ({ s, best: Math.min(...s.tags.map(rank).filter((i) => i >= 0)) }))
    .filter((x) => Number.isFinite(x.best))
    .sort((a, b) => a.best - b.best || (b.s.visits || 0) - (a.s.visits || 0))
    .map((x) => x.s);
  const include = stores.length >= MIN_MATCHING_STORES;
  return { include, stores, reason: include ? `Stop here for ${listNames(stores.map((s) => s.name))}.` : null };
}
