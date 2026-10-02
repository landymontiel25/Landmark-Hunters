import { effectiveTagScores, sitewideTagCounts } from './tagScores.js';
import {
  PREDICTION_MIN_EVIDENCE_TAGS,
  PREDICTION_MIN_SCALE,
  PREDICTION_MIN_TAG_RATINGS,
  PREDICTION_MIN_TOTAL_RATINGS,
  PREDICTION_NEGATIVE_CUTOFF,
  PREDICTION_POSITIVE_CUTOFF,
  PREDICTION_WARM_START_WEIGHT,
} from './maprConstants.js';

// The hidden prediction saved with every shown pick. Pure; never rendered.
//
// Rule:
//  1. scores = the user's decayed per-tag scores for the place's region,
//     topped up with their tastes from other cities while they are new to
//     this one (effectiveTagScores with PREDICTION_WARM_START_WEIGHT).
//  2. Return null if the user has fewer than PREDICTION_MIN_TOTAL_RATINGS
//     ratings in all, or the place has no tags.
//  3. Evidence tags = the place's tags with at least PREDICTION_MIN_TAG_RATINGS
//     ratings behind them (tagCounts summed over regions). Fewer than
//     PREDICTION_MIN_EVIDENCE_TAGS of them -> null.
//  4. mean = average score of the evidence tags.
//  5. scale = max(PREDICTION_MIN_SCALE, largest |score| among the user's
//     scores in that region); fraction = mean / scale, in -1..1.
//  6. fraction >= PREDICTION_POSITIVE_CUTOFF -> 'positive';
//     <= PREDICTION_NEGATIVE_CUTOFF -> 'negative'; otherwise 'neutral'.
export function predictLevel({ profile, region, tags, nowMs = Date.now() }) {
  const counts = sitewideTagCounts(profile);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total < PREDICTION_MIN_TOTAL_RATINGS) return null;
  const placeTags = [...new Set(tags || [])];
  if (!placeTags.length || !region) return null;

  const scores = effectiveTagScores(profile, region, nowMs, { warmStartWeight: PREDICTION_WARM_START_WEIGHT });
  const evidence = placeTags.filter((t) => (counts[t] || 0) >= PREDICTION_MIN_TAG_RATINGS);
  if (evidence.length < Math.max(1, PREDICTION_MIN_EVIDENCE_TAGS)) return null;

  const mean = evidence.reduce((s, t) => s + (scores[t] || 0), 0) / evidence.length;
  const scale = Math.max(PREDICTION_MIN_SCALE, ...Object.values(scores).map((v) => Math.abs(v)));
  const fraction = mean / scale;
  if (fraction >= PREDICTION_POSITIVE_CUTOFF) return 'positive';
  if (fraction <= PREDICTION_NEGATIVE_CUTOFF) return 'negative';
  return 'neutral';
}
