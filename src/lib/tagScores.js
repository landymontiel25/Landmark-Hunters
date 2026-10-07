import { ALL_LANDMARKS } from '../data/regions.js';
import { AWAY_VOTE_MILES, AWAY_VOTE_WEIGHT, RATING_TAG_DELTA, TAP_TAG_DELTA } from './maprConstants.js';

// Per-region tag scoring for Mapr Picks. A "tag" is a landmark's category id
// (food, history-culture, ...), the same ids signup interests use. Everything
// here is scoped to one region: Milan's "history" never touches Miami's,
// except for the phased-out warm start in effectiveTagScores.
//
// Firestore shape on users/{uid}:
//   tagScores[region][tag]   = score as of tagScoresAt (never above TAG_CAP)
//   tagScoresAt[region][tag] = ms timestamp that score was last written
//   tagCounts[region][tag]   = ratings behind that score (keeps climbing past the cap)
//   capAnswers[tag]          = 'yes' | 'no' -- answer to the at-cap prompt, one per tag for all regions
//   capNotes[tag]            = free-text comment from that prompt
//   (tagBoosts[region][tag] / tagNotes[region][tag] are the older per-region
//   form of those two; capAnswer/capNote still read them.)
//   picksShown[region][id]   = 'YYYY-MM-DD' a pick was last on screen, not yet settled
//   timesShownNotVisited[region][id] = days it was shown and ignored
//
// Exponential decay is linear, so decaying one running total from its last
// write equals decaying every rating from its own timestamp and summing.
// That lets us store one number per tag instead of every contribution.
// Plain .js import paths: api/mapr-picks.js runs this under Node on Vercel.

// Numbers live in maprConstants.js (RATING_TAG_DELTA / TAP_TAG_DELTA).
export const TAG_DELTAS = {
  'highly-recommend': RATING_TAG_DELTA.positive,
  'worth-trying': RATING_TAG_DELTA.neutral,
  'probably-skip': RATING_TAG_DELTA.negative,
};
export const HALF_LIFE_DAYS = 90;
export const TAG_CAP = 100;
export const TAG_FLOOR = -100;
export const BOOST_MULTIPLIER = 1.5;
export const SHORTLIST_SIZE = 30;
// Most shortlist slots one tag can take, so a top category can't fill all
// 30 by itself. A tag the user said "lean into it" to gets 1.5x the room.
export const PER_TAG_LIMIT = 12;
// A tag's first FULL_VALUE_RATINGS ratings move its score in full; later
// ones count half, so a proven tag keeps reacting instead of piling up.
export const FULL_VALUE_RATINGS = 5;
// Other regions' scores lend WARM_START_WEIGHT of themselves to a region the
// user is new to, fading linearly to zero by WARM_START_RATINGS local ratings.
export const WARM_START_WEIGHT = 0.4;
export const WARM_START_RATINGS = 15;
// Scores this close count as a tie, and the tag with more ratings behind it wins.
export const CLOSE_SCORE = 3;
// Shortlist slots held for tags the user has barely rated.
export const WILDCARD_SLOTS = 4;
export const WILDCARD_MAX_RATINGS = 2;
// Days a pick can sit on screen without a visit before its tag takes a
// small hit, and how big that hit is (a "not for me" is -15).
export const IGNORE_LIMIT = 3;
export const IGNORE_DELTA = -3;
// Bump when the stored shape or deltas change, so clients rebuild from reviews.
// 5: how often you visit (FREQUENCY_MULTIPLIER) scales a rating's delta.
export const TAG_SCORES_VERSION = 5;
// One taste per traveler, not one per city: every rating, tap and comment
// lands in tagScores[GLOBAL_TASTE] and every reader uses it, so not liking
// museums in Miami means not liking museums in Paris. The per-city maps are
// still written (older app versions read them) but no longer read once the
// global map exists. Accounts from before get it rebuilt once from
// everything they told Mapr (rebuildGlobalTaste, see useGlobalTaste.js).
export const GLOBAL_TASTE = 'all';
export const GLOBAL_TASTE_VERSION = 1;
export const hasGlobalTaste = (profile) => !!profile?.tagScores?.[GLOBAL_TASTE];
// A ✓/✗ on a Mapr Pick is a lighter signal than a full rating, and doesn't
// count as a rating behind a tag (tagCounts).
export const VOTE_DELTAS = { yes: TAP_TAG_DELTA.positive, no: TAP_TAG_DELTA.negative };

// How much one tap counts: AWAY_VOTE_WEIGHT when the place is more than
// AWAY_VOTE_MILES from where you were (pick_feedback's rounded `near`), else 1.
// Unknown position or place counts in full. Derived from data every vote
// already stores, so the live path and the rebuilds always agree.
let byIdCache = { size: -1, map: new Map() };
function landmarkById() {
  if (byIdCache.size !== ALL_LANDMARKS.length) {
    byIdCache = { size: ALL_LANDMARKS.length, map: new Map(ALL_LANDMARKS.map((l) => [`${l.regionId}/${l.id}`, l])) };
  }
  return byIdCache.map;
}
export function voteWeight(near, region, landmarkId, place = null) {
  const l = place && Number.isFinite(place.lat) ? place : landmarkById().get(`${region}/${landmarkId}`);
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lng) || !l || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return 1;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(l.lat - near.lat);
  const dLng = toRad(l.lng - near.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(near.lat)) * Math.cos(toRad(l.lat)) * Math.sin(dLng / 2) ** 2;
  const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return miles > AWAY_VOTE_MILES ? AWAY_VOTE_WEIGHT : 1;
}
const weightedVoteDelta = (v) => (VOTE_DELTAS[v.verdict] || 0) * voteWeight(v.near, v.region, v.landmarkId);
// A rating from someone who keeps coming back is stronger proof of taste
// than a single visit -- scales the tier delta before it's applied. Applies
// both directions: someone who comes here a lot saying "not for me" is just
// as informative as loving it. Missing/unknown frequency (older reviews,
// votes, or a skipped question) is 1x, unchanged from before this existed.
export const FREQUENCY_MULTIPLIER = { 'not-often': 1, sometimes: 1.3, 'a-lot': 1.6 };

const DAY_MS = 86400000;
const UNRATEABLE = new Set(['dorms', 'campus-life']);

const clampScore = (v) => Math.max(TAG_FLOOR, Math.min(TAG_CAP, v));

export function decayFactor(fromMs, nowMs) {
  if (!fromMs) return 1;
  const ageDays = Math.max(0, nowMs - fromMs) / DAY_MS;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// One rating applied to one region's tag maps. Returns only the tags it
// touched, plus which of them landed on the cap, so callers can merge-write.
// `frequency` (FREQUENCIES ids in ratingFlow.js) scales the delta -- how
// often you visit is a stronger or weaker vote of confidence than a single
// visit; unknown/missing frequency is 1x.
export function applyRating({ scores = {}, at = {}, counts = {} }, tags, tier, nowMs, frequency = null, factor = 1, deltaOverride = null) {
  const delta = deltaOverride ?? TAG_DELTAS[tier];
  const next = { scores: {}, at: {}, counts: {}, capped: [] };
  if (delta == null) return next;
  const mult = (FREQUENCY_MULTIPLIER[frequency] || 1) * factor;
  for (const tag of new Set(tags || [])) {
    const prior = counts[tag] || 0;
    const step = (prior >= FULL_VALUE_RATINGS ? delta / 2 : delta) * mult;
    const value = clampScore((scores[tag] || 0) * decayFactor(at[tag], nowMs) + step);
    next.scores[tag] = value;
    next.at[tag] = nowMs;
    next.counts[tag] = prior + 1;
    if (value >= TAG_CAP) next.capped.push(tag);
  }
  return next;
}

// Takes one earlier applyRating back out (an edited or deleted rating), so
// the profile only ever holds the rating's CURRENT effect. `counts` already
// includes the rating being removed, so its step is the one applyRating used
// at prior = count - 1. Decay since then isn't recoverable, so this is
// approximate for old ratings, but never drifts by a whole step per edit.
export function revertRating({ scores = {}, counts = {} }, tags, tier, frequency = null, factor = 1, deltaOverride = null) {
  const delta = deltaOverride ?? TAG_DELTAS[tier];
  const next = { scores: {}, counts: {} };
  if (delta == null) return next;
  const mult = (FREQUENCY_MULTIPLIER[frequency] || 1) * factor;
  for (const tag of new Set(tags || [])) {
    if (!(counts[tag] > 0)) continue;
    const prior = counts[tag] - 1;
    const step = (prior >= FULL_VALUE_RATINGS ? delta / 2 : delta) * mult;
    next.scores[tag] = clampScore((scores[tag] || 0) - step);
    next.counts[tag] = prior;
  }
  return next;
}

export function applyVote({ scores = {}, at = {} }, tags, verdict, nowMs, deltaOverride) {
  const delta = deltaOverride ?? VOTE_DELTAS[verdict];
  const next = { scores: {}, at: {}, counts: {}, capped: [] };
  if (delta == null) return next;
  for (const tag of new Set(tags || [])) {
    const value = clampScore((scores[tag] || 0) * decayFactor(at[tag], nowMs) + delta);
    next.scores[tag] = value;
    next.at[tag] = nowMs;
    if (value >= TAG_CAP) next.capped.push(tag);
  }
  return next;
}

// Takes one earlier applyVote back out (a changed tap). `delta` is what was
// applied to every tag (stored on the place_scores doc, so retuning the
// constants later never corrupts an undo).
export function revertVote({ scores = {} }, tags, delta) {
  const next = { scores: {} };
  if (!delta) return next;
  for (const tag of new Set(tags || [])) next.scores[tag] = clampScore((scores[tag] || 0) - delta);
  return next;
}

// Per-tag deltas (a comment's effect): { tag: points }. Same decay-then-add
// as applyVote; counts untouched, like a tap.
export function applyTagDeltas({ scores = {}, at = {} }, deltas, nowMs) {
  const next = { scores: {}, at: {} };
  for (const [tag, d] of Object.entries(deltas || {})) {
    if (!d) continue;
    next.scores[tag] = clampScore((scores[tag] || 0) * decayFactor(at[tag], nowMs) + d);
    next.at[tag] = nowMs;
  }
  return next;
}

export function revertTagDeltas({ scores = {} }, deltas) {
  const next = { scores: {} };
  for (const [tag, d] of Object.entries(deltas || {})) if (d) next.scores[tag] = clampScore((scores[tag] || 0) - d);
  return next;
}

// Replays a user's saved reviews and Mapr Picks votes ({ region, categories,
// verdict, at }) oldest-first, for users scored under an older
// TAG_SCORES_VERSION. Same math as the live paths.
export function rebuildTagScores(reviews, votes = []) {
  const toMs = (r) => (r.updatedAt?.seconds ? r.updatedAt.seconds * 1000 : r.updatedAtMs || 0);
  const out = { tagScores: {}, tagScoresAt: {}, tagCounts: {} };
  const events = [
    ...(reviews || []).filter((r) => TAG_DELTAS[r.ratingTier]).map((r) => ({ r, ms: toMs(r) })),
    ...(votes || []).filter((v) => VOTE_DELTAS[v.verdict]).map((v) => ({ v, ms: v.at || 0 })),
  ].sort((a, b) => a.ms - b.ms);
  for (const { r, v, ms } of events) {
    const region = (r || v).region;
    if (!region) continue;
    const cur = {
      scores: out.tagScores[region] || {},
      at: out.tagScoresAt[region] || {},
      counts: out.tagCounts[region] || {},
    };
    const next = r
      ? applyRating(cur, r.categories, r.ratingTier, ms || Date.now(), r.visitFrequency || null)
      : applyVote(cur, v.categories, v.verdict, ms || Date.now(), weightedVoteDelta(v));
    out.tagScores[region] = { ...cur.scores, ...next.scores };
    out.tagScoresAt[region] = { ...cur.at, ...next.at };
    out.tagCounts[region] = { ...cur.counts, ...next.counts };
  }
  return out;
}

// One overall taste rebuilt from everything the traveler told Mapr, oldest
// first, with the same math as the live paths (maprLearning.js): ratings
// (with visit frequency and the comment's tag deltas), Travel Picks / pick
// votes, and the sign-up swipe answers once (not once per city, as the old
// per-city seed did). Returns the maps for tagScores/tagScoresAt/tagCounts
// [GLOBAL_TASTE].
export function rebuildGlobalTaste({ reviews = [], votes = [], seedDeltas = {}, seedAtMs = null, commentDeltas = () => ({}), nowMs = Date.now() } = {}) {
  const toMs = (r) => {
    for (const t of [r.ratedAt, r.updatedAt, r.updatedAtMs]) {
      const ms = typeof t === 'number' ? t : t?.toMillis ? t.toMillis() : typeof t?.seconds === 'number' ? t.seconds * 1000 : NaN;
      if (Number.isFinite(ms)) return ms;
    }
    return 0;
  };
  const events = [
    ...(reviews || []).filter((r) => TAG_DELTAS[r?.ratingTier]).map((r) => ({ r, ms: toMs(r) })),
    ...(votes || []).filter((v) => VOTE_DELTAS[v?.verdict]).map((v) => ({ v, ms: v.at || 0 })),
  ].sort((a, b) => a.ms - b.ms);
  let m = { scores: {}, at: {}, counts: {} };
  const merge = (next) => {
    m = { scores: { ...m.scores, ...(next.scores || {}) }, at: { ...m.at, ...(next.at || {}) }, counts: { ...m.counts, ...(next.counts || {}) } };
  };
  if (seedDeltas && Object.keys(seedDeltas).length) {
    merge(applyTagDeltas(m, seedDeltas, seedAtMs ?? events[0]?.ms ?? nowMs));
  }
  for (const { r, v, ms } of events) {
    const at = ms || nowMs;
    if (r) {
      merge(applyRating(m, r.categories || [], r.ratingTier, at, r.visitFrequency || null));
      const c = r.comment ? commentDeltas(r.comment, r.categories || []) : {};
      if (Object.keys(c).length) merge(applyTagDeltas(m, c, at));
    } else {
      merge(applyVote(m, v.categories || [], v.verdict, at, weightedVoteDelta(v)));
    }
  }
  return m;
}

function decayedRegion(profile, region, nowMs) {
  const scores = profile?.tagScores?.[region] || {};
  const at = profile?.tagScoresAt?.[region] || {};
  const out = {};
  for (const [tag, raw] of Object.entries(scores)) {
    out[tag] = clampScore(Number(raw) || 0) * decayFactor(at[tag], nowMs);
  }
  return out;
}

// Ratings behind each tag: the overall taste's once the account has one.
export const tasteCounts = (profile, region) => profile?.tagCounts?.[hasGlobalTaste(profile) ? GLOBAL_TASTE : region] || {};

export function localRatingCount(profile, region) {
  return Object.values(tasteCounts(profile, region)).reduce((s, n) => s + (Number(n) || 0), 0);
}

// Weight other regions lend this one: 40% with no local ratings, 0 at 15.
export function warmStartWeight(profile, region, base = WARM_START_WEIGHT) {
  return base * Math.max(0, 1 - localRatingCount(profile, region) / WARM_START_RATINGS);
}

// Decayed, capped scores for one region, topped up by the warm start from
// the user's other regions, with a 1.5x multiplier on any tag the user said
// "yes, lean into it" to. Only this ranking view can exceed the cap; the
// stored score never does.
// opts.warmStartWeight overrides how much other regions lend (default
// WARM_START_WEIGHT); the hidden prediction uses a fuller loan, see
// maprPrediction.js.
export function effectiveTagScores(profile, region, nowMs = Date.now(), opts = {}) {
  // The one overall taste, the same in every city.
  if (hasGlobalTaste(profile)) {
    const out = {};
    for (const [tag, v] of Object.entries(decayedRegion(profile, GLOBAL_TASTE, nowMs))) {
      out[tag] = v > 0 && capAnswer(profile, tag) === 'yes' ? v * BOOST_MULTIPLIER : v;
    }
    return out;
  }
  const local = decayedRegion(profile, region, nowMs);
  const w = warmStartWeight(profile, region, opts.warmStartWeight ?? WARM_START_WEIGHT);
  const borrowed = {};
  if (w > 0) {
    const sums = {};
    const seen = {};
    for (const other of Object.keys(profile?.tagScores || {})) {
      if (other === region) continue;
      for (const [tag, v] of Object.entries(decayedRegion(profile, other, nowMs))) {
        sums[tag] = (sums[tag] || 0) + v;
        seen[tag] = (seen[tag] || 0) + 1;
      }
    }
    for (const tag of Object.keys(sums)) borrowed[tag] = (sums[tag] / seen[tag]) * w;
  }
  const out = {};
  for (const tag of new Set([...Object.keys(local), ...Object.keys(borrowed)])) {
    const v = clampScore((local[tag] || 0) + (borrowed[tag] || 0));
    out[tag] = v > 0 && capAnswer(profile, tag) === 'yes' ? v * BOOST_MULTIPLIER : v;
  }
  return out;
}

// The at-cap prompt is asked once per tag, whatever region hit the cap, and
// its answer applies in every region.
export function capAnswer(profile, tag) {
  const flat = profile?.capAnswers?.[tag];
  if (flat) return flat;
  for (const byTag of Object.values(profile?.tagBoosts || {})) if (byTag?.[tag]) return byTag[tag];
  return null;
}

export function capNote(profile, tag) {
  const flat = profile?.capNotes?.[tag];
  if (flat) return flat;
  for (const byTag of Object.values(profile?.tagNotes || {})) if (byTag?.[tag]) return byTag[tag];
  return '';
}

// Every answered tag, merged across the new and older storage.
export function capMaps(profile) {
  const tags = new Set([
    ...Object.keys(profile?.capAnswers || {}),
    ...Object.keys(profile?.capNotes || {}),
    ...Object.values(profile?.tagBoosts || {}).flatMap((m) => Object.keys(m || {})),
    ...Object.values(profile?.tagNotes || {}).flatMap((m) => Object.keys(m || {})),
  ]);
  const answers = {};
  const notes = {};
  for (const tag of tags) {
    if (capAnswer(profile, tag)) answers[tag] = capAnswer(profile, tag);
    if (capNote(profile, tag)) notes[tag] = capNote(profile, tag);
  }
  return { answers, notes };
}

// The first tag sitting at the cap in any region that the user hasn't
// answered the "lean into it?" prompt for yet. Null when there's nothing to ask.
export function pendingCapPrompt(profile) {
  for (const [region, tags] of Object.entries(profile?.tagScores || {})) {
    for (const [tag, score] of Object.entries(tags || {})) {
      if (score >= TAG_CAP && !capAnswer(profile, tag)) return { region, tag };
    }
  }
  return null;
}

// Region the traveler is in: nearest landmark's region to a GPS fix, else
// the region they were last planning or rating.
// The region to pick from: the one nearest your GPS fix, else the first of
// `fallbackRegions`. With `excludeIds` (places you've already been to or
// rated), a region with nothing new left is skipped for the next-nearest --
// someone who's done every landmark at Villanova gets Philadelphia picks,
// not an empty row.
export function pickRegion({ origin, fallbackRegions = [], excludeIds = null }) {
  const hasNew = (region) => !excludeIds || candidates(region, excludeIds).length > 0;
  if (origin) {
    const nearest = {};
    for (const l of ALL_LANDMARKS) {
      const d = (l.lat - origin.lat) ** 2 + ((l.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180)) ** 2;
      if (!(l.regionId in nearest) || d < nearest[l.regionId]) nearest[l.regionId] = d;
    }
    const byDistance = Object.keys(nearest).sort((a, b) => nearest[a] - nearest[b]);
    const found = byDistance.find(hasNew);
    if (found) return found;
    if (byDistance.length && !excludeIds) return byDistance[0];
  }
  return fallbackRegions.filter(Boolean).find(hasNew) || null;
}

function candidates(region, excludeIds) {
  const exclude = new Set(excludeIds || []);
  return ALL_LANDMARKS.filter(
    (l) => l.regionId === region && !exclude.has(l.id) && !(l.categories || []).every((c) => UNRATEABLE.has(c))
  );
}

const byDemand = (checkinCounts) => (a, b) =>
  (checkinCounts[b.id] || 0) - (checkinCounts[a.id] || 0) || (b.popularity || 0) - (a.popularity || 0);

// Walks a ranked list keeping at most tagLimit(tag) per tag; anything held
// back fills the leftover slots, so a small region still returns a full list.
function takeWithTagLimit(ranked, limit, tagLimit) {
  const perTag = {};
  const kept = [];
  const heldBack = [];
  for (const item of ranked) {
    if (kept.length >= limit) break;
    const tag = item.l.categories?.[0];
    if ((perTag[tag] || 0) < tagLimit(tag)) {
      perTag[tag] = (perTag[tag] || 0) + 1;
      kept.push(item);
    } else {
      heldBack.push(item);
    }
  }
  return [...kept, ...heldBack].slice(0, limit);
}

// Step 6 (+ steps 9 and 10): sum the user's effective tag scores over each
// landmark's tags. Scores within CLOSE_SCORE of each other rank by how many
// ratings back the tag, then by check-in count and editorial popularity.
// Keeps at most PER_TAG_LIMIT per tag, and holds WILDCARD_SLOTS for tags the
// user has barely rated so picks can find new interests.
export function scoreShortlist({
  scores,
  region,
  tagCounts = {},
  excludeIds = [],
  checkinCounts = {},
  boostedTags = [],
  limit = SHORTLIST_SIZE,
  wildcardSlots = WILDCARD_SLOTS,
  random = Math.random,
}) {
  const demand = byDemand(checkinCounts);
  const boosted = new Set(boostedTags);
  const tagLimit = (tag) => (boosted.has(tag) ? Math.round(PER_TAG_LIMIT * BOOST_MULTIPLIER) : PER_TAG_LIMIT);
  const pool = candidates(region, excludeIds);

  // Wildcards: tags outside the user's top 3, rated at most twice here, and
  // not disliked. One place per tag (its most-visited), tags in random order.
  const topTags = new Set(
    Object.entries(scores)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t)
  );
  const wildTags = [...new Set(pool.map((l) => l.categories?.[0]))].filter(
    (t) => t && !topTags.has(t) && (tagCounts[t] || 0) <= WILDCARD_MAX_RATINGS && (scores[t] || 0) >= 0
  );
  for (let i = wildTags.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wildTags[i], wildTags[j]] = [wildTags[j], wildTags[i]];
  }
  const wildcards = wildTags
    .slice(0, wildcardSlots)
    .map((t) => pool.filter((l) => l.categories?.[0] === t).sort(demand)[0])
    .filter(Boolean);
  const wildIds = new Set(wildcards.map((l) => l.id));

  const scoreOf = (l) => (l.categories || []).reduce((s, t) => s + (scores[t] || 0), 0);
  const countOf = (l) => tagCounts[l.categories?.[0]] || 0;
  const ranked = pool
    .filter((l) => !wildIds.has(l.id))
    .map((l) => ({ l, score: scoreOf(l) }))
    .sort(
      (a, b) =>
        Math.floor(b.score / CLOSE_SCORE) - Math.floor(a.score / CLOSE_SCORE) ||
        countOf(b.l) - countOf(a.l) ||
        b.score - a.score ||
        demand(a.l, b.l)
    );
  const main = takeWithTagLimit(ranked, limit - wildcards.length, tagLimit);
  const round = (n) => Math.round(n * 10) / 10;
  return [
    ...main.map(({ l, score }) => ({ ...l, tagScore: round(score), tagRatings: countOf(l) })),
    ...wildcards.map((l) => ({ ...l, tagScore: round(scoreOf(l)), tagRatings: countOf(l), wildcard: true })),
  ];
}

// Step 8: no rating signal in this region yet. Landmarks in the user's
// signup interests (built-in category ids, plus any landmarks their custom
// "Add Your Own" interests matched) come first, most-checked-in first, at
// most PER_TAG_LIMIT per tag. The rest of the region fills out the list.
export function coldStartShortlist({
  region,
  interests = [],
  customMatchIds = [],
  excludeIds = [],
  checkinCounts = {},
  limit = SHORTLIST_SIZE,
}) {
  const wanted = new Set(interests);
  const custom = new Set(customMatchIds);
  const fits = (l) => custom.has(`${l.regionId}/${l.id}`) || (l.categories || []).some((c) => wanted.has(c));
  const pool = candidates(region, excludeIds).sort(byDemand(checkinCounts));
  const ranked = [...pool.filter(fits), ...pool.filter((l) => !fits(l))].map((l) => ({ l }));
  return takeWithTagLimit(ranked, limit, () => PER_TAG_LIMIT).map(({ l }) => ({ ...l, tagScore: 0, tagRatings: 0 }));
}

const boostedTagsFor = (profile) =>
  Object.entries(capMaps(profile).answers)
    .filter(([, answer]) => answer === 'yes')
    .map(([tag]) => tag);

export function buildShortlist({ profile, region, now = Date.now(), ...rest }) {
  const scores = effectiveTagScores(profile, region, now);
  const hasSignal = Object.values(scores).some((v) => Math.abs(v) > 0.01);
  return {
    coldStart: !hasSignal,
    shortlist: hasSignal
      ? scoreShortlist({
          scores,
          region,
          tagCounts: tasteCounts(profile, region),
          boostedTags: boostedTagsFor(profile),
          ...rest,
        })
      : coldStartShortlist({ region, ...rest }),
  };
}

// On-device picks from the same shortlist the server hands Claude, for
// replacement cards after a vote and for when the AI call fails. Takes the
// shortlist in order and slots in one wildcard; match % comes from the score.
export function localTagPicks({ profile, region, limit = 10, now = Date.now(), ...rest }) {
  if (!region) return [];
  const { coldStart, shortlist } = buildShortlist({ profile, region, now, ...rest });
  const main = shortlist.filter((l) => !l.wildcard);
  const wild = shortlist.find((l) => l.wildcard);
  const chosen = wild && limit > 1 ? [...main.slice(0, limit - 1), wild] : main.slice(0, limit);
  return chosen.map((l) => ({
    id: l.id,
    region: l.regionId,
    name: l.name,
    image: l.images?.[0] || null,
    categories: l.categories || [],
    matchPercentage: l.wildcard || coldStart ? 62 : Math.round(Math.max(50, Math.min(97, 62 + l.tagScore * 0.33))),
    oneLineSummary: (l.summary || '').split(/[.!?]/)[0].slice(0, 90),
    ...(l.wildcard ? { wildcard: true } : {}),
  }));
}

// Signup swipe cards + free-text notes, and NOTHING else: no signup-interest
// chips, no plain city popularity across unrelated categories. A landmark
// only gets in if its category was swiped "love it" (tagDeltas > 0 for it),
// or its name/summary/facts matches a word from the notes/loved cards
// (keywords). check-in popularity only breaks ties INSIDE that filtered
// set -- it can decide which loved-category place wins, never pull in a
// place from a category nobody swiped on.
const KEYWORD_MATCH_BONUS = 6;
const STOPWORDS = new Set([
  'love', 'loves', 'like', 'likes', 'about', 'also', 'said', 'into', 'sure', 'with', 'that',
  'this', 'have', 'really', 'want', 'when', 'what', 'from', 'they', 'them', 'care', 'much',
  'very', 'just', 'dont', 'places', 'place', 'things', 'thing', 'stuff', 'kind', 'kinds',
]);

// Meaningful words (4+ letters, stopwords dropped) from free text -- run on
// notes, or on the "Loves: X, Y." style sentence tasteIntroFromAnswers
// produces, so the server can derive the same keywords from just the
// tasteIntro string it's already sent.
export function noteKeywords(text) {
  const words = (text || '').toLowerCase().match(/[a-z']{4,}/g) || [];
  return [...new Set(words)].filter((w) => !STOPWORDS.has(w));
}

export function swipeShortlist({
  region,
  tagDeltas = {},
  keywords = [],
  excludeIds = [],
  checkinCounts = {},
  limit = SHORTLIST_SIZE,
}) {
  const pool = candidates(region, excludeIds);
  const textOf = (l) => `${l.name} ${l.summary || ''} ${(l.facts || []).join(' ')}`.toLowerCase();
  const matches = (l) => keywords.some((kw) => textOf(l).includes(kw));
  const scoreOf = (l) => {
    const catScore = (l.categories || []).reduce((s, c) => s + (tagDeltas[c] || 0), 0);
    return catScore + (matches(l) ? KEYWORD_MATCH_BONUS : 0);
  };
  const demand = byDemand(checkinCounts);
  const ranked = pool
    .map((l) => ({ l, score: scoreOf(l) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || demand(a.l, b.l));
  const round = (n) => Math.round(n * 10) / 10;
  return takeWithTagLimit(ranked, limit, () => PER_TAG_LIMIT).map(({ l, score }) => ({ ...l, tagScore: round(score) }));
}

// Same on-device shape localTagPicks returns, built from swipeShortlist
// instead -- for the Test tab's "Instant picks" panel.
export function localSwipePicks({ region, tagDeltas, keywords = [], limit = 10, ...rest }) {
  if (!region) return [];
  const shortlist = swipeShortlist({ region, tagDeltas, keywords, limit: Math.max(limit, SHORTLIST_SIZE), ...rest });
  return shortlist.slice(0, limit).map((l) => ({
    id: l.id,
    region: l.regionId,
    name: l.name,
    image: l.images?.[0] || null,
    categories: l.categories || [],
    matchPercentage: Math.round(Math.max(50, Math.min(97, 62 + l.tagScore * 0.8))),
    oneLineSummary: (l.summary || '').split(/[.!?]/)[0].slice(0, 90),
  }));
}

// No region to score in (no location, no ratings, no saved cities): the
// most-checked-into landmarks across every region combined, ties broken by
// the catalog's editorial popularity. With signup interests, landmarks in
// those interests (built-in category ids, plus landmarks custom interests
// matched) rank first; the rest only fill slots the interests can't. With
// no interests it's pure popularity.
export function globalPopularPicks({ excludeIds = [], checkinCounts = {}, interests = [], customMatchIds = [], limit = 10 }) {
  const exclude = new Set(excludeIds);
  const wanted = new Set(interests);
  const custom = new Set(customMatchIds);
  const fits = (l) => custom.has(`${l.regionId}/${l.id}`) || (l.categories || []).some((c) => wanted.has(c));
  const pool = ALL_LANDMARKS.filter(
    (l) => !exclude.has(l.id) && !(l.categories || []).every((c) => UNRATEABLE.has(c))
  ).sort(byDemand(checkinCounts));
  const ranked = wanted.size || custom.size ? [...pool.filter(fits), ...pool.filter((l) => !fits(l))] : pool;
  return ranked.slice(0, limit).map((l) => ({
    id: l.id,
    region: l.regionId,
    name: l.name,
    image: l.images?.[0] || null,
    categories: l.categories || [],
    matchPercentage: 62,
    oneLineSummary: (l.summary || '').split(/[.!?]/)[0].slice(0, 90),
  }));
}

// Step 13. Settles picks shown on an earlier day: a visit (or a vote, or a
// rating) clears the landmark's ignore count; otherwise that day counts as
// one ignore, and the IGNORE_LIMIT-th one nudges its tag down by
// IGNORE_DELTA. Returns full replacement maps plus the tag scores to patch.
export function settleShownPicks(profile, { engagedIds = [], today, nowMs = Date.now() }) {
  const engaged = new Set(engagedIds);
  const picksShown = {};
  const ignored = {};
  const nudges = [];
  let changed = false;
  for (const [region, ids] of Object.entries(profile?.timesShownNotVisited || {})) {
    for (const [id, n] of Object.entries(ids || {})) {
      if (engaged.has(id)) changed = true;
      else (ignored[region] ||= {})[id] = n;
    }
  }
  for (const [region, ids] of Object.entries(profile?.picksShown || {})) {
    for (const [id, day] of Object.entries(ids || {})) {
      if (engaged.has(id)) {
        changed = true;
        if (ignored[region]) delete ignored[region][id];
      } else if (day < today) {
        changed = true;
        const n = ((ignored[region] ||= {})[id] || 0) + 1;
        ignored[region][id] = n;
        const tag = ALL_LANDMARKS.find((l) => l.regionId === region && l.id === id)?.categories?.[0];
        if (n === IGNORE_LIMIT && tag) nudges.push({ region, tag });
      } else {
        (picksShown[region] ||= {})[id] = day;
      }
    }
  }
  const scorePatch = {};
  // With one overall taste the nudge lands there too (the city map is still
  // kept up for older app versions).
  if (hasGlobalTaste(profile)) for (const { tag } of [...nudges]) nudges.push({ region: GLOBAL_TASTE, tag });
  for (const { region, tag } of nudges) {
    const key = `${region}/${tag}`;
    const cur = scorePatch[key] || {
      value: Number(profile?.tagScores?.[region]?.[tag]) || 0,
      at: profile?.tagScoresAt?.[region]?.[tag],
    };
    scorePatch[key] = {
      region,
      tag,
      value: clampScore(cur.value * decayFactor(cur.at, nowMs) + IGNORE_DELTA),
      at: nowMs,
    };
  }
  return { changed, picksShown, timesShownNotVisited: ignored, scorePatches: Object.values(scorePatch) };
}

// Step 16. Tag multipliers for the time a plan is FOR (not when it's being
// built). Only positive scores get multiplied, so a disliked tag never gets
// pushed further down by its time slot.
export const TIME_SLOTS = [
  { id: 'morning', label: 'morning (6-11am)', start: 6, end: 11, boosts: { 'parks-nature': 1.2, 'history-culture': 1.1 } },
  { id: 'lunch', label: 'lunch (11am-2pm)', start: 11, end: 14, boosts: { food: 1.3 } },
  { id: 'afternoon', label: 'afternoon (2-5pm)', start: 14, end: 17, boosts: { 'art-museums': 1.2, 'history-culture': 1.2 } },
  { id: 'dinner', label: 'dinner (5-8pm)', start: 17, end: 20, boosts: { food: 1.3 } },
  { id: 'night', label: 'night (8pm-3am)', start: 20, end: 27, boosts: { 'local-life': 1.3, entertainment: 1.2 } },
];
// Friday and Saturday nights lean harder into bars and clubs.
export const WEEKEND_NIGHT_BOOSTS = { 'local-life': 1.5, entertainment: 1.3 };

// day: 0 = Sunday ... 6 = Saturday, hour: 0-23 local time.
export function timeSlotFor(day, hour) {
  const h = hour < 3 ? hour + 24 : hour;
  const slot = TIME_SLOTS.find((s) => h >= s.start && h < s.end) || null;
  // After midnight still belongs to the night before.
  const nightOf = hour < 3 ? (day + 6) % 7 : day;
  const weekendNight = slot?.id === 'night' && (nightOf === 5 || nightOf === 6);
  return { slot, weekendNight, boosts: weekendNight ? WEEKEND_NIGHT_BOOSTS : slot?.boosts || {} };
}

export function applyTimeSlot(scores, boosts) {
  const out = {};
  for (const [tag, v] of Object.entries(scores)) out[tag] = v > 0 && boosts[tag] ? v * boosts[tag] : v;
  return out;
}

// Plan Your Trip's "What sounds good?" step. Both are pure, on-device
// rankings over the user's saved tag scores -- no AI call is made to rank.
//
// A tag counts as "new" to someone while it has at most NEW_PICK_MAX_RATINGS
// ratings behind it in the traveler's one overall taste (tasteCounts), so a
// category rated 20 times in Miami isn't new to them in Villanova. Accounts
// not moved to one taste yet still count per city.
export const NEW_PICK_MAX_RATINGS = WILDCARD_MAX_RATINGS;
// "Something new" spreads across categories instead of five of one kind.
export const NEW_PICK_PER_TAG = 2;

export function sitewideTagCounts(profile) {
  const out = {};
  for (const byTag of Object.values(profile?.tagCounts || {})) {
    for (const [tag, n] of Object.entries(byTag || {})) out[tag] = (out[tag] || 0) + (Number(n) || 0);
  }
  return out;
}

const firstRateableTag = (l) => (l.categories || []).find((c) => !UNRATEABLE.has(c)) || null;

// "The usual": the region's landmarks ranked by the user's saved tag scores
// (the same scoreShortlist Mapr Picks runs, minus its wildcard slots), kept
// to places their taste actually scores above zero.
export function usualPicks({ profile, region, excludeIds = [], checkinCounts = {}, limit = 6, now = Date.now() }) {
  if (!region) return [];
  const scores = effectiveTagScores(profile, region, now);
  return scoreShortlist({
    scores,
    region,
    tagCounts: tasteCounts(profile, region),
    excludeIds,
    checkinCounts,
    boostedTags: boostedTagsFor(profile),
    limit: Math.max(limit, SHORTLIST_SIZE),
    wildcardSlots: 0,
  })
    .filter((l) => l.tagScore > 0)
    .slice(0, limit)
    .map((l) => ({ ...l, pickType: 'usual' }));
}

// "Something new": landmarks whose main category the user has rated little
// or never (NEW_PICK_MAX_RATINGS, see tasteCounts), with nothing they've
// disliked on them, ranked by how close they still land to the user's taste
// -- any liked secondary category pushes a place up, so it's new territory
// that still fits their taste.
export function discoveryPicks({ profile, region, excludeIds = [], checkinCounts = {}, limit = 6, now = Date.now() }) {
  if (!region) return [];
  const scores = effectiveTagScores(profile, region, now);
  const counts = tasteCounts(profile, region);
  const demand = byDemand(checkinCounts);
  const scoreOf = (l) => (l.categories || []).reduce((s, t) => s + (scores[t] || 0), 0);
  const ranked = candidates(region, excludeIds)
    .filter((l) => {
      const tag = firstRateableTag(l);
      if (!tag || (counts[tag] || 0) > NEW_PICK_MAX_RATINGS) return false;
      return (l.categories || []).every((t) => (scores[t] || 0) >= 0);
    })
    .map((l) => ({ l, score: scoreOf(l) }))
    .sort((a, b) => b.score - a.score || demand(a.l, b.l));
  const round = (n) => Math.round(n * 10) / 10;
  return takeWithTagLimit(ranked, limit, () => NEW_PICK_PER_TAG).map(({ l, score }) => ({
    ...l,
    tagScore: round(score),
    tagRatings: counts[firstRateableTag(l)] || 0,
    pickType: 'new',
  }));
}
