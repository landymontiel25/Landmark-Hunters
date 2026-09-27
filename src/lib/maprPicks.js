import { chipLabel } from './ratingFlow';

// The taste model behind the Taste Profile Score's leave-one-out
// prediction check (tasteProfile.js), plus the Mapr Picks cache helpers.
// Mapr Picks' ranking itself lives in tagScores.js.

// Category alone is too coarse to learn from fast: a zoo and a hiking trail
// both read as "parks-nature", a cemetery and a historic mansion both read
// as "history-culture". What actually explains a rating is the SPECIFIC
// reason behind it -- the traveler's own words, in their comment and the
// chip they tapped -- not the broad bucket the landmark happens to sit in.
// This list is the vocabulary that reasoning runs on: matched against a
// review's comment + chip labels on one side, and a candidate's own
// name/summary on the other. Two kinds of entries: concrete place TYPES
// (a zoo is never a hiking trail, whatever the category says) and
// experiential TRAITS pulled straight from how people actually describe
// why they loved or skipped somewhere.
const TRAIT_KEYWORDS = [
  // Specific place types.
  'zoo',
  'aquarium',
  'cemetery',
  'safari',
  'amusement park',
  'theme park',
  'water park',
  'cricket club',
  'country club',
  'social club',
  'meeting house',
  // Experiential traits -- "loved it for the rooftop view" should boost
  // other places whose own description mentions a view, not just
  // "restaurants" or "parks" in general.
  'rooftop',
  'view',
  'waterfront',
  'scenic',
  'crowded',
  'long lines',
  'busy',
  'quiet',
  'peaceful',
  'relaxing',
  'live music',
  'nightlife',
  'family-friendly',
  'kid-friendly',
  'romantic',
  'historic',
];

// Every TRAIT_KEYWORDS entry found in `text` (lowercased, substring match --
// simple on purpose, since it only needs to catch the traveler's own words
// closely enough to recognize the same kind of place or the same reason
// again).
function keywordsIn(text) {
  const t = (text || '').toLowerCase();
  return TRAIT_KEYWORDS.filter((k) => t.includes(k));
}

// Recent signal matters more than old signal (preferences shift -- someone
// who loved clubs at 21 might not at 25), but old signal should FADE, not
// vanish outright. Halves every ~4 months. A review/vote with no known
// timestamp (older data, or a caller that doesn't have one) is treated as
// full-weight rather than guessed at as stale.
const RECENCY_HALF_LIFE_DAYS = 120;
function recencyWeight(seconds, nowSec) {
  if (!seconds) return 1;
  const ageDays = Math.max(0, nowSec - seconds) / 86400;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

// Builds the same category-affinity + trait-keyword model localMaprPicks
// scores candidates against, but as its own reusable step -- so
// tasteProfile.js's prediction-confidence check (predict a rating from
// every OTHER rating, see how close it lands) runs the identical reasoning
// Mapr Picks itself uses, not a separate approximation of it.
export function buildTasteModel(reviews, nowSec = Date.now() / 1000) {
  const affinity = {};
  const positiveTraits = new Map();
  const negativeTraits = new Set();
  const softNegativeTraits = new Map();
  for (const r of reviews || []) {
    // weight < 1: a lighter signal than a rating, e.g. a Mapr Picks vote.
    const rw = recencyWeight(r.updatedAt?.seconds, nowSec) * (r.weight ?? 1);
    const w = (r.tier === 'highly-recommend' ? 3 : r.tier === 'probably-skip' ? -3 : 1) * rw;
    for (const c of r.categories || []) affinity[c] = (affinity[c] || 0) + w;
    const text = [r.name, r.comment, ...(r.highlights || []).map(chipLabel)].filter(Boolean).join(' ');
    for (const kw of keywordsIn(text)) {
      if (r.tier === 'highly-recommend') {
        positiveTraits.set(kw, (positiveTraits.get(kw) || 0) + rw);
      } else if (r.tier === 'probably-skip') {
        if (rw >= 0.35) negativeTraits.add(kw);
        else softNegativeTraits.set(kw, (softNegativeTraits.get(kw) || 0) + rw);
      }
    }
  }
  return { affinity, positiveTraits, negativeTraits, softNegativeTraits };
}

// The model's raw (unbounded) predicted affinity for one review's landmark,
// from a taste model built on OTHER reviews -- category affinity plus
// whatever traits the review's own text/highlights name.
export function predictedAffinityScore(review, model) {
  const cat = review.categories?.[0];
  const text = [review.name, review.comment, ...(review.highlights || []).map(chipLabel)].filter(Boolean).join(' ');
  const kws = keywordsIn(text);
  let traitScore = 0;
  let hardNegative = false;
  for (const kw of kws) {
    if (model.positiveTraits.has(kw)) traitScore += model.positiveTraits.get(kw);
    if (model.softNegativeTraits.has(kw)) traitScore -= model.softNegativeTraits.get(kw);
    if (model.negativeTraits.has(kw)) hardNegative = true;
  }
  const catAffinity = model.affinity[cat] || 0;
  return catAffinity + traitScore + (hardNegative ? -3 : 0);
}

// Picks are cached per user, keyed on how many ratings they had at the
// time -- a new rating is one thing that should change them; the other is
// just time passing, since votes on the current set (which don't change
// ratingsCount) should still get a genuinely fresh batch from the AI
// before too long, not wait a full day. Shortened from 24h so a session's
// worth of ✓/✗ feedback actually gets re-reasoned about soon, not just
// patched over locally until the cache key itself changes.
const TTL_MS = 4 * 60 * 60 * 1000;
// Keyed on a coarse (~10 km) location too, so walking across town keeps
// the same picks but flying to another city gets fresh ones.
export const coarseLocation = (origin) => (origin ? `${origin.lat.toFixed(1)},${origin.lng.toFixed(1)}` : 'nowhere');
// Bump this whenever a change to the scoring/ranking logic (local or
// server) should force EVERY user's next load to recompute fresh, rather
// than possibly keep serving a list built under the old rules until the
// TTL or ratingsCount happens to change. Old-prefixed entries are simply
// never read again -- harmless dead keys, not worth cleaning up.
const CACHE_VERSION = 'v4';
// tasteFP (tasteQuestions.js's tasteFingerprint) covers everything a
// traveler has told Mapr that ISN'T a landmark rating -- the onboarding/
// Settings taste intro and the taste baseline's like/dislike picks +
// per-category comments. Without it in the key, answering or editing the
// baseline never changed ratingsCount, so Mapr Picks kept serving picks
// computed before those answers existed until the 4-hour TTL happened to
// expire -- exactly the "picks don't reflect what I just told Mapr" bug.
export const picksCacheKey = (uid, ratingsCount, origin, tasteFP = '') =>
  `lh-mapr-picks:${CACHE_VERSION}:${uid}:${ratingsCount}:${tasteFP}:${coarseLocation(origin)}`;

export function readPicksCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, picks } = JSON.parse(raw);
    if (!Array.isArray(picks) || Date.now() - at > TTL_MS) return null;
    return picks;
  } catch {
    return null;
  }
}

export function writePicksCache(key, picks) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), picks }));
  } catch {
    /* private mode */
  }
}
