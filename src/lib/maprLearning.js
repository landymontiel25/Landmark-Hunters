import {
  DISAGREEMENT_NEW_WEIGHT,
  DISAGREEMENT_OLD_WEIGHT,
  DISAGREEMENT_ONE_OFF_LEVEL,
  MISS_TYPE_FACTOR,
  MISS_WEIGHTS,
  PLACE_COMMENT_CAP,
  PLACE_COMMENT_MULT,
  PLACE_MISS_DELTA,
  PLACE_RATING_DELTA,
  PLACE_SCORE_CAP,
  PLACE_TAP_DELTA,
  RATING_TAG_DELTA,
  TAP_TAG_DELTA,
} from './maprConstants.js';
import { applyRating, applyTagDeltas, applyVote, revertRating, revertTagDeltas, revertVote, GLOBAL_TASTE, hasGlobalTaste } from './tagScores.js';
import { commentTagDeltas } from './commentSignals.js';
import { reasonKind } from './rerating.js';

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

export function placeScoreOf({ tap = null, tapOff = false, rating = null, ratingDelta = null, commentDeltas = {}, miss = 0 }) {
  const commentSum = Object.values(commentDeltas || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const total =
    (tapOff ? 0 : PLACE_TAP_DELTA[tap] || 0) +
    (ratingDelta ?? (PLACE_RATING_DELTA[rating] || 0)) +
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
//           comment: string,
//           resolution: { reason, oldLevel, oldKind } }
//   resolution comes with a new `rating` when the user's own answers were two
//   levels apart and they said why (rerating.js, docs/rerating.md): it decides
//   how the old and new answers count. oldKind is 'rating' or 'tap'.
// Returns { userPatch, ledger }: userPatch is the tag-score fields to merge
// into users/{uid} (or null for no change), ledger is the place_scores doc to
// write (or null when no signal is left, i.e. delete it).
//
// The ledger records exactly what sits on the type score (typeTier/Frequency/
// Factor/Delta, commentTypeDeltas, tapDelta), which can differ from the answer
// itself (a place-only reason leaves the type alone), so any later edit or
// delete takes out precisely what was put in.
export function planLearning({ user = {}, prev = null, legacy = {}, landmark, next = {}, nowMs = Date.now() }) {
  const region = landmark.region ?? landmark.regionId ?? null;
  const cats = landmark.categories?.length ? landmark.categories : prev?.categories || legacy.rating?.categories || [];

  // --- what is applied now ---
  // old.answer = the rating as the user gave it; old.rating = what it put on
  // the type score (may be nothing, or something other than the answer).
  const old = { tap: null, answer: null, rating: null, comment: null };
  if (prev?.tap) {
    old.tap = { level: prev.tap, delta: Number(prev.tapDelta) || 0, region: prev.region, categories: prev.categories || [], at: prev.tapAt || null };
  } else if (legacy.tap && levelOfVerdict(legacy.tap.verdict)) {
    const level = levelOfVerdict(legacy.tap.verdict);
    old.tap = { level, delta: level === 'neutral' ? 0 : TAP_TAG_DELTA[level], region: legacy.tap.region, categories: legacy.tap.categories || [], at: null };
  }
  if (prev?.ratingTier) {
    const hasType = prev.typeTier !== undefined; // docs from before changed answers have no type* fields
    const typeTier = hasType ? prev.typeTier : prev.ratingTier;
    old.answer = { tier: prev.ratingTier, frequency: prev.ratingFrequency || null, at: prev.ratingAt || null };
    old.rating = typeTier
      ? {
          tier: typeTier,
          frequency: (hasType ? prev.typeFrequency : prev.ratingFrequency) || null,
          factor: hasType ? (prev.typeFactor ?? 1) : Number(prev.ratingFactor) || 1,
          delta: hasType ? prev.typeDelta ?? null : null,
          region: prev.region,
          categories: prev.categories || [],
        }
      : null;
  } else if (legacy.rating?.tier) {
    old.answer = { tier: legacy.rating.tier, frequency: legacy.rating.frequency || null, at: null };
    old.rating = { tier: legacy.rating.tier, frequency: legacy.rating.frequency || null, factor: 1, delta: null, region: legacy.rating.region, categories: legacy.rating.categories || [] };
  }
  old.comment = { deltas: prev?.commentTypeDeltas ?? prev?.commentDeltas ?? {}, region: prev?.region, categories: prev?.categories || [] };

  // --- what should be applied ---
  const tapLevel = next.tap !== undefined ? next.tap : old.tap?.level || null;
  const answerNext = next.rating !== undefined ? next.rating : old.answer ? { tier: old.answer.tier, frequency: old.answer.frequency } : null;
  const ratingLevel = answerNext ? levelOfTier(answerNext.tier) : null;
  const newAnswer = answerNext?.tier && ratingLevel ? { tier: answerNext.tier, frequency: answerNext.frequency || null } : null;

  // How the user said an answer that moved two levels should count. Given with
  // a new rating, or carried on the ledger while the rating is untouched.
  const freshRes = next.rating !== undefined && newAnswer && next.resolution?.reason ? next.resolution : null;
  const reason = freshRes ? freshRes.reason : next.rating === undefined && newAnswer ? prev?.resolution || null : null;
  const kind = reasonKind(reason);
  const oldLevelForBlend = freshRes?.oldLevel || ratingLevel;
  // For the miss record, a one-off visit counts as the middle level.
  const scoreLevel = kind === 'one-off' ? DISAGREEMENT_ONE_OFF_LEVEL : ratingLevel;
  const missFact = newAnswer ? missWeightFor(tapLevel, scoreLevel) : 0;
  // The extra "I'd go, then didn't like it" penalty only when the user did not
  // explain the change: their explanation replaces it.
  const missScoring = reason ? 0 : missFact;

  let typeSpec = null;
  let placeRatingDelta = null;
  if (newAnswer) {
    if (next.rating === undefined && reason) {
      // Rating untouched: keep exactly what was applied.
      typeSpec = old.rating;
      placeRatingDelta = prev?.placeRatingDelta ?? null;
    } else if (kind === 'place-only') {
      // The type keeps whatever the earlier rating put there; the new answer adds nothing to it.
      typeSpec = old.rating && freshRes?.oldKind !== 'tap' ? old.rating : null;
    } else if (kind === 'one-off') {
      typeSpec = { tier: 'worth-trying', frequency: newAnswer.frequency, factor: 1, delta: null, region, categories: cats };
      placeRatingDelta = PLACE_RATING_DELTA[DISAGREEMENT_ONE_OFF_LEVEL];
    } else if (kind === 'blend') {
      typeSpec = {
        tier: newAnswer.tier,
        frequency: newAnswer.frequency,
        factor: 1,
        delta: round2(DISAGREEMENT_NEW_WEIGHT * RATING_TAG_DELTA[ratingLevel] + DISAGREEMENT_OLD_WEIGHT * RATING_TAG_DELTA[oldLevelForBlend]),
        region,
        categories: cats,
      };
      placeRatingDelta = round2(DISAGREEMENT_NEW_WEIGHT * PLACE_RATING_DELTA[ratingLevel] + DISAGREEMENT_OLD_WEIGHT * PLACE_RATING_DELTA[oldLevelForBlend]);
    } else {
      // No explanation needed, or "changed my mind" / "wrong about this type".
      typeSpec = { tier: newAnswer.tier, frequency: newAnswer.frequency, factor: missScoring ? MISS_TYPE_FACTOR : 1, delta: null, region, categories: cats };
    }
  }

  // A tap that the new rating replaces as "the old answer": its effect on the
  // place always goes; on the type it goes too unless the reason keeps the type alone.
  const tapReplaced = !!freshRes && freshRes.oldKind === 'tap';
  const tapDrop = tapReplaced && kind !== 'place-only';
  // With the rating gone again, a tap that still sits on the type counts on the place again.
  const tapPlaceOff = tapReplaced
    ? true
    : next.tap === undefined || (old.tap && old.tap.level === tapLevel)
      ? !!prev?.tapPlaceOff && !(!newAnswer && old.tap?.delta)
      : false;

  const newTap = tapLevel
    ? {
        level: tapLevel,
        delta: tapDrop ? 0 : old.tap?.level === tapLevel && old.tap.region === region && sameCats(old.tap.categories, cats) ? old.tap.delta : TAP_TAG_DELTA[tapLevel] || 0,
        region,
        categories: cats,
      }
    : null;

  let commentDeltas;
  let commentTypeDeltas;
  const placeOnly = kind === 'place-only';
  if (!newAnswer) {
    commentDeltas = {};
    commentTypeDeltas = {};
  } else if (next.comment !== undefined) {
    commentDeltas = commentTagDeltas(next.comment, cats);
    commentTypeDeltas = placeOnly ? {} : commentDeltas;
  } else {
    commentDeltas = prev?.commentDeltas || {};
    commentTypeDeltas = next.rating !== undefined ? (placeOnly ? {} : commentDeltas) : prev?.commentTypeDeltas ?? commentDeltas;
  }

  // --- work out which parts changed ---
  const specSig = (r) => r && [r.tier, r.frequency, r.factor, r.delta ?? null, r.region, [...(r.categories || [])].sort()];
  const tapSig = (t) => t && [t.level, t.delta, t.region, [...t.categories].sort()];
  const tapChanged = sig(tapSig(old.tap)) !== sig(tapSig(newTap));
  const typeChanged = sig(specSig(old.rating)) !== sig(specSig(typeSpec));
  const answerChanged = sig(old.answer && [old.answer.tier, old.answer.frequency]) !== sig(newAnswer && [newAnswer.tier, newAnswer.frequency]);
  const commentChanged = sig(old.comment.deltas) !== sig(commentTypeDeltas) || (Object.keys(commentTypeDeltas).length > 0 && old.comment.region !== region);

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
  // Every change also lands in the one overall taste (GLOBAL_TASTE) once the
  // account has it, the same way, so undoing an edit stays exact there too.
  const keysFor = (r) => (hasGlobalTaste(user) ? [r, GLOBAL_TASTE] : [r]);
  const apply = (r, op) => {
    for (const k of keysFor(r)) {
      const m = get(k);
      merge(m, op(m));
    }
  };
  if (tapChanged && old.tap?.delta && old.tap.region) {
    apply(old.tap.region, (m) => revertVote(m, old.tap.categories, old.tap.delta));
  }
  if (typeChanged && old.rating?.region) {
    apply(old.rating.region, (m) => revertRating(m, old.rating.categories, old.rating.tier, old.rating.frequency, old.rating.factor, old.rating.delta));
  }
  if (commentChanged && old.comment.region && Object.keys(old.comment.deltas).length) {
    apply(old.comment.region, (m) => revertTagDeltas(m, old.comment.deltas));
  }
  if (typeChanged && typeSpec?.region) {
    apply(region, (m) => applyRating(m, typeSpec.categories, typeSpec.tier, nowMs, typeSpec.frequency, typeSpec.factor, typeSpec.delta));
  }
  if (tapChanged && newTap?.delta && region) {
    apply(region, (m) => applyVote(m, newTap.categories, VERDICT_OF_LEVEL[newTap.level], nowMs, newTap.delta));
  }
  if (commentChanged && region && Object.keys(commentTypeDeltas).length) {
    apply(region, (m) => applyTagDeltas(m, commentTypeDeltas, nowMs));
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
  if (!newTap && !newAnswer) return { userPatch, ledger: null };
  const tapAt = newTap ? (tapChanged || !old.tap ? nowMs : old.tap?.at || nowMs) : null;
  const ratingAt = newAnswer ? (answerChanged || !old.answer ? nowMs : old.answer?.at || nowMs) : null;
  // The newest answer, for the later taste-score item: whichever of tap and
  // rating was given last (the rating on a tie).
  const latestIsRating = !!newAnswer && (!newTap || ratingAt >= tapAt);
  const ledger = {
    landmarkId: landmark.id,
    region,
    categories: cats,
    tap: newTap?.level || null,
    tapDelta: newTap?.delta || 0,
    tapAt,
    tapPlaceOff: !!(newTap && tapPlaceOff),
    rating: ratingLevel,
    ratingTier: newAnswer?.tier || null,
    ratingFrequency: newAnswer?.frequency || null,
    ratingFactor: typeSpec?.factor ?? 1,
    ratingAt,
    // What the rating actually put on the type score (null = nothing).
    typeTier: typeSpec?.tier || null,
    typeFrequency: typeSpec?.frequency || null,
    typeFactor: typeSpec?.factor ?? 1,
    typeDelta: typeSpec?.delta ?? null,
    placeRatingDelta: newAnswer ? placeRatingDelta : null,
    resolution: newAnswer ? reason : null,
    latestLevel: latestIsRating ? ratingLevel : newTap.level,
    latestSource: latestIsRating ? 'rating' : 'tap',
    latestAt: latestIsRating ? ratingAt : tapAt,
    commentDeltas,
    commentTypeDeltas,
    placeScore: placeScoreOf({ tap: tapLevel, tapOff: tapPlaceOff, rating: ratingLevel, ratingDelta: placeRatingDelta, commentDeltas, miss: missScoring }),
    // For the later taste-score item: Mapr said "you'd go" and the answer was
    // "didn't like it". missWeight is 0 when there was no miss.
    predicted: missFact ? tapLevel : null,
    outcome: missFact ? scoreLevel : null,
    missWeight: missFact,
  };
  return { userPatch, ledger };
}
