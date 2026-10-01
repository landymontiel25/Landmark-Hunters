import { describe, it, expect } from 'vitest';
import {
  TASTE_HALF_MISS_CREDIT,
  TASTE_MIN_GUESSES,
  TASTE_PERFECT_WINDOW,
  TASTE_SNAPSHOT_EVERY_ANSWERS,
  TASTE_SNAPSHOT_MIN_MS,
  TASTE_WINDOW,
} from './maprConstants';
import {
  buildPredictions,
  computeBaseline,
  computeTasteScore,
  creditFor,
  historySnapshot,
  mostCommonAnswer,
  shouldSnapshot,
  tasteSummary,
} from './tasteScore';

// Fixture: n places, each shown at 1000+i*10 with a guess, answered at 5000+i.
const place = (i, answered, extra = {}) => ({ landmarkId: `p${i}`, latestLevel: answered, latestAt: 5000 + i, ratingAt: 500, rating: answered, ...extra });
const row = (i, predicted, extra = {}) => ({ landmarkId: `p${i}`, predicted, shownAt: 1000 + i * 10, isTest: false, setId: 's', ...extra });
function world(pairs) {
  return {
    rows: pairs.map(([p], i) => row(i, p)),
    places: pairs.map(([, a], i) => place(i, a)),
  };
}
const score = (pairs, opts) => computeTasteScore(buildPredictions(world(pairs)), opts);
const same = (n, level = 'positive') => Array.from({ length: n }, () => [level, level]);

describe('creditFor', () => {
  it('same level is a hit, one off a small miss, two off a big miss', () => {
    expect(creditFor('positive', 'positive')).toBe(1);
    expect(creditFor('positive', 'neutral')).toBe(0.5);
    expect(creditFor('neutral', 'negative')).toBe(0.5);
    expect(creditFor('positive', 'negative')).toBe(0);
    expect(creditFor('negative', 'positive')).toBe(0);
    expect(creditFor('positive', null)).toBeNull();
  });
});

describe('taste score', () => {
  it('is credit-weighted hits out of the guesses, as a percent', () => {
    // 2 hits (2) + 1 small miss (.5) + 1 big miss (0) over 4... pad to the minimum with hits.
    const s = score([...same(1), ['positive', 'neutral'], ['positive', 'negative'], ...same(1, 'negative')]);
    expect(s.guesses).toBe(4 + 0);
    const s5 = score([...same(1), ['positive', 'neutral'], ['positive', 'negative'], ...same(2, 'negative')]);
    expect(s5.guesses).toBe(5);
    expect(s5.hits).toBe(3);
    expect(s5.smallMisses).toBe(1);
    expect(s5.bigMisses).toBe(1);
    expect(s5.percent).toBeCloseTo(((3 + 0.5) / 5) * 100);
    expect(s5.score).toBe(70);
    expect(s5.state).toBe('ready');
    expect(s.state).toBe('learning');
  });

  it('shows Learning (null score) under the minimum, the percent from the minimum on', () => {
    expect(score(same(TASTE_MIN_GUESSES - 1))).toMatchObject({ state: 'learning', score: null, guesses: TASTE_MIN_GUESSES - 1 });
    expect(score(same(TASTE_MIN_GUESSES))).toMatchObject({ state: 'ready' });
    expect(score([])).toMatchObject({ state: 'learning', score: null, guesses: 0, percent: null });
  });

  it('only the last 20 predictions count', () => {
    const old = Array.from({ length: 10 }, () => ['positive', 'negative']); // ten big misses, oldest
    const recent = same(TASTE_WINDOW);
    const s = score([...old, ...recent]);
    expect(s.guesses).toBe(TASTE_WINDOW);
    expect(s.totalGuesses).toBe(TASTE_WINDOW + 10);
    expect(s.percent).toBe(100);
    // Slide the window one step: one new big miss pushes one old hit out.
    const s2 = score([...old, ...recent, ['positive', 'negative']]);
    expect(s2.guesses).toBe(TASTE_WINDOW);
    expect(s2.percent).toBeCloseTo((19 / 20) * 100);
    expect(s2.bigMisses).toBe(1);
  });

  it('never displays above 99% unless the last 100 were all full hits', () => {
    const s20 = score(same(TASTE_WINDOW));
    expect(s20.percent).toBe(100);
    expect(s20.score).toBe(99);
    const s99 = score(same(TASTE_PERFECT_WINDOW - 1));
    expect(s99.score).toBe(99);
    const s100 = score(same(TASTE_PERFECT_WINDOW));
    expect(s100.score).toBe(100);
    // One small miss anywhere inside the last 100 keeps it at 99.
    const pairs = same(TASTE_PERFECT_WINDOW);
    pairs[3] = ['positive', 'neutral'];
    expect(score(pairs).score).toBe(99);
    // A miss older than the last 100 does not.
    expect(score([['positive', 'negative'], ...same(TASTE_PERFECT_WINDOW)]).score).toBe(100);
  });

  it('a 99.6% rounds down to the cap, never up to 100', () => {
    const s = computeTasteScore(Array.from({ length: 20 }, () => ({ credit: 0.998, gap: 0 })), { window: 20 });
    expect(s.score).toBeLessThanOrEqual(99);
  });
});

describe('pairing guesses with answers', () => {
  it('the answer must come after the pick was shown', () => {
    const rows = [row(0, 'positive')];
    expect(buildPredictions({ rows, places: [place(0, 'positive', { latestAt: 1000 })] })).toHaveLength(0); // same instant
    expect(buildPredictions({ rows, places: [place(0, 'positive', { latestAt: 900 })] })).toHaveLength(0); // before
    expect(buildPredictions({ rows, places: [place(0, 'positive', { latestAt: 1001 })] })).toHaveLength(1);
  });

  it('ignores picks with no guess, test picks, and picks from before the first rating', () => {
    const places = [0, 1, 2, 3].map((i) => place(i, 'positive', { ratingAt: 2000 }));
    const rows = [row(0, null), row(1, 'positive', { isTest: true }), row(2, 'positive', { shownAt: 1999 }), row(3, 'positive', { shownAt: 2000 })];
    const out = buildPredictions({ rows, places });
    expect(out.map((p) => p.landmarkId)).toEqual(['p3']);
  });

  it('a place shown many times is one guess about one answer (the latest pick before it)', () => {
    const rows = [row(0, 'negative', { shownAt: 3000 }), row(0, 'positive', { shownAt: 4000 }), row(0, 'neutral', { shownAt: 9000 })];
    const out = buildPredictions({ rows, places: [place(0, 'positive')] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ predicted: 'positive', gap: 0 }); // the 9000 pick came after the answer at 5000
  });

  it('accepts Firestore-style timestamps', () => {
    const rows = [row(0, 'positive', { shownAt: { toMillis: () => 3000 } })];
    expect(buildPredictions({ rows, places: [place(0, 'positive', { latestAt: { seconds: 6 } })] })).toHaveLength(1);
  });

  it('picks made for a group request do not count', () => {
    const rows = [row(0, 'positive', { requestFor: 'group' }), row(1, 'positive', { requestFor: 'solo' }), row(2, 'positive')];
    const places = [place(0, 'negative'), place(1, 'positive'), place(2, 'positive')];
    expect(buildPredictions({ rows, places }).map((p) => p.landmarkId)).toEqual(['p1', 'p2']);
  });
});

describe('the newest answer wins', () => {
  it('a re-rating changes the outcome of the same guess', () => {
    const rows = [row(0, 'positive')];
    const first = buildPredictions({ rows, places: [place(0, 'positive', { latestAt: 4000 })] })[0];
    expect(first.credit).toBe(1);
    // The user later changes their mind: place_scores.latestLevel follows.
    const later = buildPredictions({ rows, places: [place(0, 'neutral', { latestAt: 9000 })] })[0];
    expect(later).toMatchObject({ answered: 'neutral', credit: 0.5 });
    const latest = buildPredictions({ rows, places: [place(0, 'negative', { latestAt: 9500 })] })[0];
    expect(latest).toMatchObject({ answered: 'negative', credit: 0 });
  });

  it('a tap newer than a rating is the answer that counts (latestLevel)', () => {
    const rows = [row(0, 'positive')];
    const out = buildPredictions({ rows, places: [place(0, 'negative', { latestSource: 'tap', rating: 'positive' })] });
    expect(out[0].answered).toBe('negative');
  });
});

describe('place wrong, type right (half a miss)', () => {
  const miss = { missWeight: 0.5, outcome: 'negative', predicted: 'positive' };
  it('counts as half a miss instead of a big miss', () => {
    const [p] = buildPredictions({ rows: [row(0, 'positive')], places: [place(0, 'negative', miss)] });
    expect(p).toMatchObject({ halfMiss: true, credit: TASTE_HALF_MISS_CREDIT });
    expect(TASTE_HALF_MISS_CREDIT).toBe(0.5);
    const s = computeTasteScore(buildPredictions({ rows: [row(0, 'positive')], places: [place(0, 'negative', miss)] }), { minGuesses: 1 });
    expect(s).toMatchObject({ halfMisses: 1, bigMisses: 0, hits: 0, percent: 50 });
  });
  it('stops counting once a re-rating clears the miss (missWeight 0) or the answer moved on', () => {
    const cleared = buildPredictions({ rows: [row(0, 'positive')], places: [place(0, 'negative', { missWeight: 0 })] })[0];
    expect(cleared).toMatchObject({ halfMiss: false, credit: 0 });
    const moved = buildPredictions({ rows: [row(0, 'positive')], places: [place(0, 'neutral', miss)] })[0];
    expect(moved).toMatchObject({ halfMiss: false, credit: 0.5 });
  });
  it('is not a perfect-run hit', () => {
    const preds = Array.from({ length: TASTE_PERFECT_WINDOW }, () => ({ credit: 1, gap: 0 }));
    preds[50] = { credit: 0.5, gap: 2, halfMiss: true };
    expect(computeTasteScore(preds).score).toBe(99);
  });
});

describe('baseline (always guess the most common answer)', () => {
  it('picks the most common answer, ties broken positive > neutral > negative', () => {
    expect(mostCommonAnswer([{ latestLevel: 'neutral' }, { latestLevel: 'neutral' }, { latestLevel: 'positive' }])).toBe('neutral');
    expect(mostCommonAnswer([{ latestLevel: 'negative' }, { latestLevel: 'positive' }])).toBe('positive');
    expect(mostCommonAnswer([])).toBeNull();
  });

  it('scores the same predictions as if Mapr always said that answer', () => {
    // Answers: 4 positive, 1 negative. Mapr guessed all negative (0 hits...). Baseline guesses positive.
    const pairs = [['negative', 'positive'], ['negative', 'positive'], ['negative', 'positive'], ['negative', 'positive'], ['negative', 'negative']];
    const w = world(pairs);
    const preds = buildPredictions(w);
    expect(computeTasteScore(preds).percent).toBe(20);
    const base = computeBaseline(preds, w.places);
    expect(base.level).toBe('positive');
    expect(base.percent).toBe(80);
    expect(base.score).toBe(80);
  });

  it('has no score while learning, and no level with no answers', () => {
    const w = world(same(2));
    expect(computeBaseline(buildPredictions(w), w.places).score).toBeNull();
    expect(computeBaseline([], [])).toEqual({ level: null, score: null, percent: null });
  });
});

describe('history snapshots', () => {
  const w = world([...same(8), ['positive', 'neutral'], ['neutral', 'positive']]);
  const summary = tasteSummary({ ...w, ratingsCount: 10 });

  it('carries the score, counts, baseline and ratings count behind it', () => {
    const snap = historySnapshot(summary, 123456);
    expect(snap).toMatchObject({
      at: 123456,
      score: 90,
      guesses: 10,
      totalGuesses: 10,
      window: TASTE_WINDOW,
      hits: 8,
      smallMisses: 2,
      bigMisses: 0,
      halfMisses: 0,
      baselineScore: 95,
      baselineLevel: 'positive',
      ratingsCount: 10,
      version: 1,
    });
  });

  it('a learning score is stored as null', () => {
    const early = tasteSummary({ ...world(same(2)), ratingsCount: 2 });
    expect(historySnapshot(early).score).toBeNull();
  });

  it('is throttled to one a day, or one per N more ratings', () => {
    const now = 10 * TASTE_SNAPSHOT_MIN_MS;
    const last = { at: now - 1000, ratingsCount: 10 };
    expect(shouldSnapshot({ last: null, summary, now })).toBe(true);
    expect(shouldSnapshot({ last, summary, now })).toBe(false);
    expect(shouldSnapshot({ last, summary: { ...summary, ratingsCount: 10 + TASTE_SNAPSHOT_EVERY_ANSWERS - 1 }, now })).toBe(false);
    expect(shouldSnapshot({ last, summary: { ...summary, ratingsCount: 10 + TASTE_SNAPSHOT_EVERY_ANSWERS }, now })).toBe(true);
    expect(shouldSnapshot({ last: { at: now - TASTE_SNAPSHOT_MIN_MS, ratingsCount: 10 }, summary, now })).toBe(true);
    expect(shouldSnapshot({ last: { at: { toMillis: () => now - 5 }, ratingsCount: 10 }, summary, now })).toBe(false);
  });

  it('nothing to record for a user with no answers at all', () => {
    expect(shouldSnapshot({ last: null, summary: tasteSummary({ rows: [], places: [] }) })).toBe(false);
  });
});
