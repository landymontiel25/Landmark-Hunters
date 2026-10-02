import { applyRating, TAG_DELTAS } from './tagScores.js';
import { predictLevel } from './maprPrediction.js';
import { computeTasteScore, creditFor } from './tasteScore.js';
import { TASTE_ESTIMATE_MIN_HISTORY } from './maprConstants.js';

// Estimated taste score from past ratings (docs/taste-score.md, "Estimate").
// DISPLAY ONLY, computed on the device from the user's own loaded reviews.
// It persists NOTHING: no Firestore, no taste_history, no recommendation_log,
// no match rate, no admin stats, so account deletion has nothing new to clear.
//
// Replay the ratings oldest first. Before each one (once TASTE_ESTIMATE_
// MIN_HISTORY earlier ratings are in), ask the real predictLevel what Mapr
// would have guessed from tag scores built ONLY from the earlier ratings, then
// credit it against the actual tier with the live score's credits. Ratings
// Mapr would not have guessed on (predictLevel null) are skipped.

const LEVEL_OF_TIER = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };

const msOf = (t) => {
  if (typeof t === 'number') return t;
  if (t?.toMillis) return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return NaN;
};

// When the rating was given: ratedAt, else updatedAt(Ms). Undated ones sort first.
const whenOf = (r) => {
  for (const t of [r.ratedAt, r.updatedAt, r.updatedAtMs]) {
    const ms = msOf(t);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
};

// reviews: array or { landmarkId: review } of { landmarkId, region, categories,
// ratingTier, visitFrequency, ratedAt, updatedAt }.
// Returns the replayed guesses (oldest first) as
// { landmarkId, predicted, answered, credit, halfMiss, at }.
export function replayGuesses(reviews, { minHistory = TASTE_ESTIMATE_MIN_HISTORY } = {}) {
  const list = (Array.isArray(reviews) ? reviews : Object.values(reviews || {}))
    .filter((r) => r && r.region && TAG_DELTAS[r.ratingTier])
    .map((r) => ({ r, at: whenOf(r) }))
    .sort((a, b) => a.at - b.at || String(a.r.landmarkId).localeCompare(String(b.r.landmarkId)));
  const profile = { tagScores: {}, tagScoresAt: {}, tagCounts: {} };
  const guesses = [];
  list.forEach(({ r, at }, i) => {
    if (i >= minHistory) {
      const predicted = predictLevel({ profile, region: r.region, tags: r.categories, nowMs: at });
      const answered = LEVEL_OF_TIER[r.ratingTier];
      const credit = predicted ? creditFor(predicted, answered) : null;
      if (credit != null) guesses.push({ landmarkId: r.landmarkId, predicted, answered, credit, halfMiss: false, at });
    }
    // Only now does this rating join the history (leave-forward).
    const cur = {
      scores: profile.tagScores[r.region] || {},
      at: profile.tagScoresAt[r.region] || {},
      counts: profile.tagCounts[r.region] || {},
    };
    const next = applyRating(cur, r.categories, r.ratingTier, at || Date.now(), r.visitFrequency || null);
    profile.tagScores[r.region] = { ...cur.scores, ...next.scores };
    profile.tagScoresAt[r.region] = { ...cur.at, ...next.at };
    profile.tagCounts[r.region] = { ...cur.counts, ...next.counts };
  });
  return guesses;
}

// { score (whole percent, same cap as live), percent, guesses, totalGuesses }
// or null when fewer than TASTE_MIN_GUESSES replayable guesses.
export function estimateTasteScore(reviews, opts = {}) {
  const s = computeTasteScore(replayGuesses(reviews, opts));
  if (s.state !== 'ready') return null;
  return { score: s.score, percent: s.percent, guesses: s.guesses, totalGuesses: s.totalGuesses };
}
