import { buildTasteModel, predictedAffinityScore } from './maprPicks';

// Taste Profile Score: NOT an activity counter. It's Mapr's own prediction
// confidence -- for every rating you've given, how close would the model's
// affinity math (the same math Mapr Picks scores candidates with) have
// guessed your actual verdict, if it only had your OTHER ratings to go on?
// Leave-one-out, not "did it see this exact answer already" -- so it can
// only go up by the model genuinely generalizing, never by memorizing.
// Personal-only, never shown on any leaderboard, no comparison to anyone else.
const TIER_TARGET = { 'highly-recommend': 1, 'worth-trying': 0, 'probably-skip': -1 };

// Squashes the model's unbounded raw affinity score onto the same -1..1
// scale as an actual verdict. /4 is a rough calibration against the
// affinity math's typical magnitudes (a single strong rating moves it by
// about 3) -- not exact, just enough that a confident prediction and a
// confident verdict land near the same end of the scale.
function squash(raw) {
  return Math.tanh(raw / 4);
}

// Below this many rated categories, confidence is capped proportionally --
// nailing predictions within a single category you've only ever rated one
// way is a much weaker claim than generalizing across several, so a narrow
// taste history plateaus here even if every leave-one-out guess lands
// dead-on.
const DIVERSITY_CATEGORIES_FOR_FULL_CONFIDENCE = 4;

/**
 * Leave-one-out prediction confidence over a user's own rated reviews.
 * `reviews` is the same shape maprPicks.buildTasteModel expects: { tier,
 * categories, name, comment, highlights, updatedAt }. Needs at least 2
 * rated reviews to produce any signal (a single rating has nothing to
 * leave out and predict from).
 */
export function computeTasteConfidence(reviews, now = Date.now()) {
  const nowSec = now / 1000;
  const rated = (reviews || []).filter((r) => TIER_TARGET[r.tier] !== undefined);
  const categoryDiversity = new Set(rated.map((r) => r.categories?.[0]).filter(Boolean)).size;

  if (rated.length < 2) {
    return { confidence: 0, sampleCount: 0, categoryDiversity };
  }

  let errorSum = 0;
  let weightSum = 0;
  for (let i = 0; i < rated.length; i++) {
    const target = rated[i];
    const others = rated.filter((_, j) => j !== i);
    const model = buildTasteModel(others, nowSec);
    const predicted = squash(predictedAffinityScore(target, model));
    const actual = TIER_TARGET[target.tier];
    const w = target.weight ?? 1;
    errorSum += Math.abs(predicted - actual) * w;
    weightSum += w;
  }
  const avgError = errorSum / weightSum; // 0 (perfect) .. 2 (exact opposite)
  const rawAccuracy = Math.max(0, 1 - avgError / 2); // 0..1

  const diversityFactor = Math.min(1, categoryDiversity / DIVERSITY_CATEGORIES_FOR_FULL_CONFIDENCE);
  const confidence = Math.round(rawAccuracy * diversityFactor * 100);
  return { confidence, sampleCount: rated.length, categoryDiversity };
}

// Insider Mode unlocks once the model can predict your taste with real
// confidence AND across enough variety to mean something -- see
// DIVERSITY_CATEGORIES_FOR_FULL_CONFIDENCE above; confidence alone is
// already gated by that, this just names the bar clearly.
export const INSIDER_MODE_CONFIDENCE = 75;

export function hasInsiderMode(confidence) {
  return confidence >= INSIDER_MODE_CONFIDENCE;
}

// Mapr Picks ✓/✗ votes as half-weight entries for computeTasteConfidence,
// skipping places that already have a full rating. "Not sure" carries no
// taste signal and is left out.
export const VOTE_WEIGHT = 0.5;
export function votesAsReviews(feedback, ratedIds = new Set()) {
  return Object.values(feedback || {})
    .filter((f) => (f.verdict === 'yes' || f.verdict === 'no') && !ratedIds.has(f.landmarkId))
    .map((f) => ({
      tier: f.verdict === 'yes' ? 'highly-recommend' : 'probably-skip',
      categories: f.categories || [],
      name: f.name || '',
      comment: '',
      highlights: [],
      updatedAt: f.at ? { seconds: f.at / 1000 } : undefined,
      weight: VOTE_WEIGHT,
    }));
}
