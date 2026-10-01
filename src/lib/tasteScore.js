import {
  PREDICTION_LEVELS,
  TASTE_BIG_MISS_CREDIT,
  TASTE_DISPLAY_CAP,
  TASTE_HALF_MISS_CREDIT,
  TASTE_HISTORY_VERSION,
  TASTE_HIT_CREDIT,
  TASTE_MIN_GUESSES,
  TASTE_PERFECT_WINDOW,
  TASTE_SMALL_MISS_CREDIT,
  TASTE_SNAPSHOT_EVERY_ANSWERS,
  TASTE_SNAPSHOT_MIN_MS,
  TASTE_WINDOW,
} from './maprConstants.js';

// The taste score, as pure functions (docs/taste-score.md). No Firebase.
//
// A prediction = the hidden guess saved with a shown pick (recommendation_log
// `predicted`) paired with the user's NEWEST answer on that place
// (place_scores `latestLevel`: a rating or a tap), given after the pick was
// shown. The score is credit-weighted hits over the last TASTE_WINDOW of them.

const INDEX = { negative: 0, neutral: 1, positive: 2 };

const msOf = (t) => {
  if (typeof t === 'number') return t;
  if (t?.toMillis) return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return NaN;
};

// Credit for one guess against the answer: same level = hit, one level off =
// small miss, two off = big miss.
export function creditFor(predicted, answered) {
  if (!(predicted in INDEX) || !(answered in INDEX)) return null;
  const gap = Math.abs(INDEX[predicted] - INDEX[answered]);
  return gap === 0 ? TASTE_HIT_CREDIT : gap === 1 ? TASTE_SMALL_MISS_CREDIT : TASTE_BIG_MISS_CREDIT;
}

// Which kind of result a prediction is, for the history counts.
const kindOf = (p) => (p.halfMiss ? 'half' : p.gap === 0 ? 'hit' : p.gap === 1 ? 'small' : 'big');

// Pair each place's newest answer with the hidden prediction on the pick that
// was shown before it. Per place only ONE prediction counts: the latest
// qualifying pick (shown before the answer), so a place re-shown five times is
// still one guess about one answer. Picks shown before the user's first
// rating, picks without a prediction, test-surface picks, picks made for a
// group request (requestFor 'group'), and picks shown
// after the answer are left out. Oldest first.
//   rows    recommendation_log docs { landmarkId, shownAt, predicted, isTest }
//   places  place_scores docs { landmarkId, latestLevel, latestAt, missWeight,
//           outcome, ratingAt }
export function buildPredictions({ rows = [], places = [] } = {}) {
  const byPlace = new Map();
  let firstRatingAt = Infinity;
  for (const p of places) {
    if (!p || !p.landmarkId) continue;
    byPlace.set(p.landmarkId, p);
    const r = msOf(p.ratingAt);
    if (Number.isFinite(r) && r < firstRatingAt) firstRatingAt = r;
  }
  const best = new Map();
  for (const r of rows) {
    // Group requests are not chosen from the user's taste, so a miss there says
    // nothing about how well Mapr knows them.
    if (!r || r.isTest === true || r.requestFor === 'group' || !PREDICTION_LEVELS.includes(r.predicted)) continue;
    const place = byPlace.get(r.landmarkId);
    if (!place || !(place.latestLevel in INDEX)) continue;
    const shownAt = msOf(r.shownAt);
    const answeredAt = msOf(place.latestAt);
    if (!Number.isFinite(shownAt) || !Number.isFinite(answeredAt)) continue;
    if (shownAt >= answeredAt) continue; // the answer must come after the pick was shown
    if (shownAt < firstRatingAt) continue; // guesses count from the first rating
    const prior = best.get(r.landmarkId);
    if (!prior || shownAt > prior.shownAt) best.set(r.landmarkId, { row: r, place, shownAt, answeredAt });
  }
  return [...best.values()]
    .map(({ row, place, shownAt, answeredAt }) => {
      const answered = place.latestLevel;
      const gap = Math.abs(INDEX[row.predicted] - INDEX[answered]);
      // "Place wrong, type right": an "I'd go" tap and then "Didn't like it"
      // (missWeight on the doc). Counts as half a miss while that miss still
      // stands, i.e. the newest answer is the one that caused it.
      const mw = Number(place.missWeight) || 0;
      const halfMiss = mw > 0 && place.outcome === answered && row.predicted === 'positive' && gap > 0;
      const base = creditFor(row.predicted, answered);
      return {
        landmarkId: row.landmarkId,
        predicted: row.predicted,
        answered,
        shownAt,
        answeredAt,
        gap,
        halfMiss,
        credit: halfMiss ? Math.max(base, TASTE_HALF_MISS_CREDIT) : base,
      };
    })
    .sort((a, b) => a.shownAt - b.shownAt);
}

const pct = (credit, n) => (n ? (credit / n) * 100 : null);

// The most common answer across the user's places (ties: positive, neutral,
// negative, in that order). Null when they have none.
export function mostCommonAnswer(places = []) {
  const n = { positive: 0, neutral: 0, negative: 0 };
  for (const p of places) if (p?.latestLevel in n) n[p.latestLevel] += 1;
  let top = null;
  for (const l of ['positive', 'neutral', 'negative']) if (n[l] > 0 && (top === null || n[l] > n[top])) top = l;
  return top;
}

// The taste score from paired predictions (see buildPredictions).
//   state   'learning' (fewer than TASTE_MIN_GUESSES) | 'ready'
//   score   what to show, 0-100 whole number, or null while learning. Capped
//           at TASTE_DISPLAY_CAP unless the last TASTE_PERFECT_WINDOW were all
//           full hits.
//   percent the uncapped, unrounded percent over the window (null if none)
export function computeTasteScore(predictions = [], { window = TASTE_WINDOW, minGuesses = TASTE_MIN_GUESSES } = {}) {
  const total = predictions.length;
  const win = predictions.slice(-window);
  const credit = win.reduce((s, p) => s + p.credit, 0);
  const counts = { hit: 0, small: 0, big: 0, half: 0 };
  for (const p of win) counts[kindOf(p)] += 1;
  const percent = pct(credit, win.length);
  const perfect =
    total >= TASTE_PERFECT_WINDOW &&
    predictions.slice(-TASTE_PERFECT_WINDOW).every((p) => p.credit === TASTE_HIT_CREDIT && !p.halfMiss);
  const ready = total >= minGuesses;
  return {
    state: ready ? 'ready' : 'learning',
    score: ready ? (perfect ? 100 : Math.min(TASTE_DISPLAY_CAP, Math.round(percent))) : null,
    percent,
    guesses: win.length,
    totalGuesses: total,
    window,
    hits: counts.hit,
    smallMisses: counts.small,
    bigMisses: counts.big,
    halfMisses: counts.half,
    credit,
  };
}

// What the score would be if Mapr had always guessed the user's most common
// answer, over the same predictions. Owner-only (Item 8); never shown to users.
export function computeBaseline(predictions = [], places = [], opts = {}) {
  const level = mostCommonAnswer(places);
  if (!level) return { level: null, score: null, percent: null };
  const same = predictions.map((p) => ({
    ...p,
    predicted: level,
    halfMiss: false,
    gap: Math.abs(INDEX[level] - INDEX[p.answered]),
    credit: creditFor(level, p.answered),
  }));
  const { percent, state } = computeTasteScore(same, opts);
  return { level, score: state === 'ready' ? Math.round(percent) : null, percent };
}

// Everything for one user in one call: the score, the baseline, and the
// count of ratings behind them (for the "accuracy at N ratings" history).
export function tasteSummary({ rows = [], places = [], ratingsCount = null } = {}) {
  const predictions = buildPredictions({ rows, places });
  const score = computeTasteScore(predictions);
  const baseline = computeBaseline(predictions, places);
  const rated = ratingsCount ?? places.filter((p) => p?.rating || p?.ratingTier).length;
  return { ...score, baseline, ratingsCount: rated };
}

// A taste_history/{id} document for a summary.
export function historySnapshot(summary, now = Date.now()) {
  return {
    at: now,
    score: summary.score ?? null,
    percent: summary.percent == null ? null : Math.round(summary.percent * 10) / 10,
    guesses: summary.guesses,
    totalGuesses: summary.totalGuesses,
    window: summary.window,
    hits: summary.hits,
    smallMisses: summary.smallMisses,
    bigMisses: summary.bigMisses,
    halfMisses: summary.halfMisses,
    baselineScore: summary.baseline?.score ?? null,
    baselineLevel: summary.baseline?.level ?? null,
    ratingsCount: summary.ratingsCount,
    version: TASTE_HISTORY_VERSION,
  };
}

// Throttle: write when there is no snapshot yet, a day has passed since the
// last one, or this many more ratings sit behind the score than at the last.
export function shouldSnapshot({ last = null, summary, now = Date.now() }) {
  if (!last) return summary.totalGuesses > 0 || summary.ratingsCount > 0;
  const lastAt = msOf(last.at);
  if (!Number.isFinite(lastAt) || now - lastAt >= TASTE_SNAPSHOT_MIN_MS) return true;
  return summary.ratingsCount - (Number(last.ratingsCount) || 0) >= TASTE_SNAPSHOT_EVERY_ANSWERS;
}
