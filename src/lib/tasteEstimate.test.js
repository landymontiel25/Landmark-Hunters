import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { estimateTasteScore, replayGuesses } from './tasteEstimate';
import { TASTE_ESTIMATE_MIN_HISTORY, TASTE_MIN_GUESSES, TASTE_WINDOW } from './maprConstants';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);
let n = 0;
const rev = (tier, day, over = {}) => ({
  landmarkId: `p${n++}`,
  region: 'r1',
  categories: ['food'],
  ratingTier: tier,
  ratedAt: T0 + day * DAY,
  ...over,
});
// k likes, one per day.
const likes = (k) => Array.from({ length: k }, (_, i) => rev('highly-recommend', i));
const then = (base, tiers) => [...base, ...tiers.map((t, i) => rev(t, base.length + i))];

describe('replayGuesses', () => {
  it('starts only after the minimum history and predicts each rating', () => {
    const g = replayGuesses(then(likes(TASTE_ESTIMATE_MIN_HISTORY), ['highly-recommend', 'probably-skip']));
    expect(g.map((x) => [x.predicted, x.answered, x.credit])).toEqual([
      ['positive', 'positive', 1],
      ['positive', 'negative', 0],
    ]);
  });

  it('replays in time order whatever the input order, and accepts a map', () => {
    const list = then(likes(TASTE_ESTIMATE_MIN_HISTORY), ['probably-skip']);
    const shuffled = [...list].reverse();
    expect(replayGuesses(shuffled)).toEqual(replayGuesses(list));
    expect(replayGuesses(Object.fromEntries(shuffled.map((r) => [r.landmarkId, r])))).toEqual(replayGuesses(list));
  });

  it('uses only ratings earlier than the one being predicted', () => {
    const base = then(likes(5), ['probably-skip']);
    const later = Array.from({ length: 10 }, (_, i) => rev('probably-skip', 50 + i));
    const withFuture = replayGuesses([...base, ...later]);
    // The day-5 guess cannot see the ten later dislikes.
    expect(withFuture[0]).toMatchObject({ predicted: 'positive', answered: 'negative', credit: 0 });
    expect(withFuture[0]).toEqual(replayGuesses(base)[0]);
  });

  it('gives small-miss credit one level off', () => {
    const g = replayGuesses(then(likes(5), ['worth-trying']));
    expect(g[0]).toMatchObject({ predicted: 'positive', answered: 'neutral', credit: 0.5 });
  });

  it('skips ratings Mapr could not have guessed (no tags / no region / no tier)', () => {
    const g = replayGuesses([
      ...likes(5),
      rev('highly-recommend', 9, { categories: [] }),
      rev('highly-recommend', 10, { region: undefined }),
      rev(undefined, 11),
    ]);
    expect(g).toEqual([]);
  });

  it('reads Firestore-style timestamps', () => {
    const list = then(likes(5), ['highly-recommend']).map((r) => ({ ...r, ratedAt: { seconds: r.ratedAt / 1000 } }));
    expect(replayGuesses(list)).toHaveLength(1);
  });
});

describe('estimateTasteScore', () => {
  it('is null under TASTE_MIN_GUESSES replayable guesses', () => {
    const k = TASTE_ESTIMATE_MIN_HISTORY + TASTE_MIN_GUESSES - 1;
    expect(estimateTasteScore(likes(k))).toBeNull();
    expect(estimateTasteScore(likes(k + 1))).not.toBeNull();
    expect(estimateTasteScore([])).toBeNull();
    expect(estimateTasteScore(undefined)).toBeNull();
  });

  it('caps at 99% when every guess hits', () => {
    const e = estimateTasteScore(likes(TASTE_ESTIMATE_MIN_HISTORY + 30));
    expect(e.percent).toBe(100);
    expect(e.score).toBe(99);
  });

  it('counts only the last TASTE_WINDOW guesses', () => {
    // Early big misses in region r1, then a full window of hits in region r2.
    const early = then(likes(5), ['probably-skip', 'probably-skip']);
    const seedR2 = Array.from({ length: 5 }, (_, i) => rev('highly-recommend', 20 + i, { categories: ['history'], region: 'r2' }));
    const hitsR2 = Array.from({ length: TASTE_WINDOW }, (_, i) => rev('highly-recommend', 30 + i, { categories: ['history'], region: 'r2' }));
    const all = [...early, ...seedR2, ...hitsR2];
    const g = replayGuesses(all);
    expect(g.some((x) => x.credit < 1)).toBe(true);
    expect(g.slice(-TASTE_WINDOW).every((x) => x.credit === 1)).toBe(true);
    expect(estimateTasteScore(all).percent).toBe(100);
  });

  it('weights hits and misses as a percent', () => {
    // 3 hits, 1 small miss, 1 big miss -> (3 + 0.5 + 0) / 5 = 70%
    const tiers = ['highly-recommend', 'highly-recommend', 'highly-recommend', 'worth-trying', 'probably-skip'];
    const e = estimateTasteScore(then(likes(5), tiers));
    expect(e.percent).toBeCloseTo(70, 5);
    expect(e.score).toBe(70);
  });

  it('does not mutate the reviews it is given', () => {
    const list = then(likes(8), ['probably-skip']);
    const copy = JSON.parse(JSON.stringify(list));
    estimateTasteScore(list);
    expect(JSON.parse(JSON.stringify(list))).toEqual(copy);
  });

  it('persists nothing: imports no Firestore, store, log, match-rate or admin code', () => {
    const src = readFileSync(new URL('./tasteEstimate.js', import.meta.url), 'utf8');
    const imports = (src.match(/from '[^']+'/g) || []).join(' ');
    expect(imports).not.toMatch(/firebase|Store|recommendationLog|adminStats|matchRate|reviews/);
  });
});
