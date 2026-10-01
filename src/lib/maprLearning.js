import {
  MISS_TYPE_FACTOR,
  MISS_WEIGHTS,
  PLACE_COMMENT_CAP,
  PLACE_COMMENT_MULT,
  PLACE_MISS_DELTA,
  PLACE_RATING_DELTA,
  PLACE_SCORE_CAP,
  PLACE_TAP_DELTA,
  TAP_TAG_DELTA,
} from './maprConstants.js';
import { applyRating, applyTagDeltas, applyVote, revertRating, revertTagDeltas, revertVote } from './tagScores.js';
import { commentTagDeltas } from './commentSignals.js';

// How Mapr learns from one place, in one pure function. Three signals only:
// the rating (tier), the tap (pick_feedback verdict) and the rating's
// comment. Two scores come out of them:
//
//  TYPE  the existing per-region tag scores on users/{uid} (tagScores,
//        tagScoresAt, tagCounts). Updated through the existing paths
//        (applyRating / applyVote), plus applyTagDeltas for comments.
//  PLACE one number for this user and this landmark, stored on
//        users/{uid}/place_scores/{landmarkId} (owner-only). A pure function of
//        the three signals, so an edit just recomputes it.
//
// The place_scores doc doubles as the ledger of what was applied to the type
// score (tapDelta, ratingFactor, commentDeltas), so changing an answer first
// takes the OLD effect back out, exactly, and then applies the new one.

export const LEVEL_OF_TIER = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };
export const LEVEL_OF_VERDICT = { yes: 'positive', unsure: 'neutral', no: 'negative' };
const VERDICT_OF_LEVEL = { positive: 'yes', neutral: 'unsure', negative: 'no' };

export const levelOfTier = (tier) => LEVEL_OF_TIER[tier] || null;
export const levelOfVerdict = (verdict) => LEVEL_OF_VERDICT[verdict] || null;

// Half a miss when the user tapped "I'd go" and then rated "Didn't like it".
export function missWeightFor(tapLevel, ratingLevel) {
  return (tapLevel && ratingLevel && MISS_WEIGHTS[`${tapLevel}>${ratingLevel}`]) || 0;
}

const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
const round2 = (n) => Math.round(n * 100) / 100;
const sig = (o) => JSON.stringify(o);
const sameCats = (a = [], b = []) => sig([...a].sort()) === sig([...b].sort());

export function placeScoreOf({ tap = null, rating = null, commentDeltas = {}, miss = 0 }) {
  const commentSum = Object.values(commentDeltas || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const total =
    (PLACE_TAP_DELTA[tap] || 0) +
    (PLACE_RATING_DELTA[rating] || 0) +
    (miss ? PLACE_MISS_DELTA : 0) +
    clamp(commentSum * PLACE_COMMENT_MULT, PLACE_COMMENT_CAP);
  return round2(clamp(total, PLACE_SCORE_CAP));
}

// prev    the existing place_scores doc (or null).
// legacy  what was applied before place_scores existed, so it can still be
//         taken back out: { rating: {tier, frequency, region, categories},
//         tap: {verdict, region, categories} } -- each only if it exists.
// next    the new answers; a key left out (undefined) means "keep as is":
//         { tap: 'positive'|'neutral'|'negative'|null,
//           rating: { tier, frequency } | null,
//           comment: string }
// Returns { userPatch, ledger }: userPatch is the tag-score fields to merge
// into users/{uid} (or null for no change), ledger is the place_scores doc to
// write (or null when no signal is left, i.e. delete it).
export function planLearning({ user = {}, prev = null, legacy = {}, landmark, next = {}, nowMs = Date.now() }) {
  const region = landmark.region ?? landmark.regionId ?? null;
  const cats = landmark.categories?.length ? landmark.categories : prev?.categories || legacy.rating?.categories || [];

  // --- what is applied now ---
  const old = { tap: null, rating: null, comment: null };
  if (prev?.tap) {
    old.tap = { level: prev.tap, delta: Number(prev.tapDelta) || 0, region: prev.region, categories: prev.categories || [], at: prev.tapAt || null };
  } else if (legacy.tap && levelOfVerdict(legacy.tap.verdict)) {
    const level = levelOfVerdict(legacy.tap.verdict);
    old.tap = { level, delta: level === 'neutral' ? 0 : TAP_TAG_DELTA[level], region: legacy.tap.region, categories: legacy.tap.categories || [], at: null };
  }
  if (prev?.ratingTier) {
    old.rating = {
      tier: prev.ratingTier,
      frequency: prev.ratingFrequency || null,
      factor: Number(prev.ratingFactor) || 1,
      region: prev.region,
      categories: prev.categories || [],
      at: prev.ratingAt || null,
    };
  } else if (legacy.rating?.tier) {
    old.rating = { tier: legacy.rating.tier, frequency: legacy.rating.frequency || null, factor: 1, region: legacy.rating.region, categories: legacy.rating.categories || [], at: null };
  }
  old.comment = { deltas: prev?.commentDeltas || {}, region: prev?.region, categories: prev?.categories || [] };

  // --- what should be applied ---
  const tapLevel = next.tap !== undefined ? next.tap : old.tap?.level || null;
  const ratingNext =
    next.rating !== undefined ? next.rating : old.rating ? { tier: old.rating.tier, frequency: old.rating.frequency } : null;
  const ratingLevel = ratingNext ? levelOfTier(ratingNext.tier) : null;
  const miss = missWeightFor(tapLevel, ratingLevel);
  const factor = miss ? MISS_TYPE_FACTOR : 1;

  const newTap = tapLevel
    ? { level: tapLevel, delta: old.tap?.level === tapLevel && old.tap.region === region && sameCats(old.tap.categories, cats) ? old.tap.delta : TAP_TAG_DELTA[tapLevel] || 0, region, categories: cats }
    : null;
  const newRating = ratingNext?.tier && ratingLevel
    ? { tier: ratingNext.tier, frequency: ratingNext.frequency || null, factor, region, categories: cats }
    : null;
  let commentDeltas;
  if (!newRating) commentDeltas = {};
  else if (next.comment !== undefined) commentDeltas = commentTagDeltas(next.comment, cats);
  else commentDeltas = old.comment.deltas;

  // --- work out which parts changed ---
  const tapChanged = sig(old.tap && [old.tap.level, old.tap.region, [...old.tap.categories].sort()]) !== sig(newTap && [newTap.level, newTap.region, [...newTap.categories].sort()]);
  const ratingChanged =
    sig(old.rating && [old.rating.tier, old.rating.frequency, old.rating.factor, old.rating.region, [...old.rating.categories].sort()]) !==
    sig(newRating && [newRating.tier, newRating.frequency, newRating.factor, newRating.region, [...newRating.categories].sort()]);
  const commentChanged = sig(old.comment.deltas) !== sig(commentDeltas) || (Object.keys(commentDeltas).length > 0 && old.comment.region !== region);

  // --- move the type score: take old effects out, then put new ones in ---
  const maps = {};
  const get = (r) =>
    (maps[r] ||= {
      scores: { ...(user?.tagScores?.[r] || {}) },
      at: { ...(user?.tagScoresAt?.[r] || {}) },
      counts: { ...(user?.tagCounts?.[r] || {}) },
    });
  let touched = false;
  const merge = (m, r) => {
    Object.assign(m.scores, r.scores || {});
    Object.assign(m.at, r.at || {});
    Object.assign(m.counts, r.counts || {});
    if (Object.keys(r.scores || {}).length) touched = true;
  };
  if (tapChanged && old.tap?.delta && old.tap.region) {
    const m = get(old.tap.region);
    merge(m, revertVote(m, old.tap.categories, old.tap.delta));
  }
  if (ratingChanged && old.rating?.region) {
    const m = get(old.rating.region);
    merge(m, revertRating(m, old.rating.categories, old.rating.tier, old.rating.frequency, old.rating.factor));
  }
  if (commentChanged && old.comment.region && Object.keys(old.comment.deltas).length) {
    const m = get(old.comment.region);
    merge(m, revertTagDeltas(m, old.comment.deltas));
  }
  if (ratingChanged && newRating?.region) {
    const m = get(region);
    merge(m, applyRating(m, newRating.categories, newRating.tier, nowMs, newRating.frequency, newRating.factor));
  }
  if (tapChanged && newTap?.delta && region) {
    const m = get(region);
    merge(m, applyVote(m, newTap.categories, VERDICT_OF_LEVEL[newTap.level], nowMs, newTap.delta));
  }
  if (commentChanged && region && Object.keys(commentDeltas).length) {
    const m = get(region);
    merge(m, applyTagDeltas(m, commentDeltas, nowMs));
  }
  let userPatch = null;
  if (touched) {
    userPatch = { tagScores: {}, tagScoresAt: {}, tagCounts: {} };
    for (const [r, m] of Object.entries(maps)) {
      userPatch.tagScores[r] = m.scores;
      userPatch.tagScoresAt[r] = m.at;
      userPatch.tagCounts[r] = m.counts;
    }
  }

  // --- the place score + ledger ---
  if (!newTap && !newRating) return { userPatch, ledger: null };
  const ledger = {
    landmarkId: landmark.id,
    region,
    categories: cats,
    tap: newTap?.level || null,
    tapDelta: newTap?.delta || 0,
    tapAt: newTap ? (tapChanged ? nowMs : old.tap?.at || nowMs) : null,
    rating: ratingLevel,
    ratingTier: newRating?.tier || null,
    ratingFrequency: newRating?.frequency || null,
    ratingFactor: newRating?.factor ?? 1,
    ratingAt: newRating ? (ratingChanged ? nowMs : old.rating?.at || nowMs) : null,
    commentDeltas,
    placeScore: placeScoreOf({ tap: tapLevel, rating: ratingLevel, commentDeltas, miss }),
    // For the later taste-score item: Mapr said "you'd go" and the answer was
    // "didn't like it". missWeight is 0 when there was no miss.
    predicted: miss ? tapLevel : null,
    outcome: miss ? ratingLevel : null,
    missWeight: miss,
  };
  return { userPatch, ledger };
}
