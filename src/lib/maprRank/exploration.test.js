import { describe, it, expect } from 'vitest';
import { assignSlots, epsilonFor, explorationSet, isStagnating, novelty, noveltyScore, quality, stagnationReport, tagCosine, unexpectedness, userState } from './exploration.js';
import { EXPLORATION } from './config.js';
import { seededRandom } from './experiments.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 86400000;
const review = (id, tier, daysAgo, visited = true) => ({ landmarkId: id, ratingTier: tier, ratedAt: NOW - daysAgo * DAY, visited });
const active = { ratings7d: 5, visits7d: 6 };

describe('epsilonFor', () => {
  it.each([
    ['default', { daysActive: 30, avgRating: 4, numRatings: 5, skipRate: 0.1, ...active }, 0.2, 'base'],
    ['new user (< 7 days)', { daysActive: 2, avgRating: 2, numRatings: 1, skipRate: 0.9, ...active }, 0.4, 'new-user'],
    ['poor matches (avg < 3.5)', { daysActive: 30, avgRating: 3, numRatings: 20, skipRate: 0.9, ...active }, 0.15, 'low-rating'],
    ['skipping a lot (> 30%)', { daysActive: 30, avgRating: 4, numRatings: 5, skipRate: 0.5, ...active }, 0.25, 'high-skip'],
    ['high confidence (> 4.2, 10+ ratings)', { daysActive: 30, avgRating: 4.5, numRatings: 12, skipRate: 0.1, ...active }, 0.15, 'high-confidence'],
    ['high rating but under 10 ratings', { daysActive: 30, avgRating: 4.5, numRatings: 9, skipRate: 0.1, ...active }, 0.2, 'base'],
  ])('%s', (_n, s, eps, reason) => {
    expect(epsilonFor(s)).toEqual({ epsilon: eps, reason });
  });

  it('adds 0.2 in a quiet week (< 3 ratings), capped at 0.5', () => {
    expect(epsilonFor({ daysActive: 30, avgRating: 4, numRatings: 5, skipRate: 0.1, ratings7d: 1, visits7d: 9 }).epsilon).toBe(0.4);
    expect(epsilonFor({ daysActive: 1, ratings7d: 0, visits7d: 0 }).epsilon).toBe(0.5);
  });

  it('falls back to the base rate with no state', () => {
    expect(epsilonFor(null).epsilon).toBe(EXPLORATION.baseEpsilon);
  });
});

describe('userState and stagnation', () => {
  const myReviews = {
    a: review('a', 'highly-recommend', 1),
    b: review('b', 'worth-trying', 2, false),
    c: review('c', 'probably-skip', 40),
  };

  it('reads days active, average stars, recent ratings and visits', () => {
    const s = userState({ myReviews, createdAtMs: NOW - 10 * DAY, now: NOW });
    expect(s.daysActive).toBe(10);
    expect(s.numRatings).toBe(3);
    expect(s.avgRating).toBe(3);
    expect(s.ratings7d).toBe(2);
    expect(s.visits7d).toBe(1);
  });

  it('skip rate = shown picks with no tap or rating since they were shown', () => {
    const shown = { a: { count: 1, firstShownAt: NOW - 3 * DAY, lastShownAt: NOW - 3 * DAY }, x: { count: 2, firstShownAt: NOW - 5 * DAY, lastShownAt: NOW - DAY }, y: { count: 1, lastShownAt: NOW - 2 * DAY }, old: { count: 1, lastShownAt: NOW - 90 * DAY } };
    const votes = { y: { verdict: 'yes', at: NOW - DAY } };
    expect(userState({ myReviews, shown, votes, now: NOW }).skipRate).toBeCloseTo(1 / 3, 10);
  });

  it('flags users under 3 ratings AND under 5 visits in 7 days', () => {
    expect(isStagnating({ ratings7d: 2, visits7d: 4 })).toBe(true);
    expect(isStagnating({ ratings7d: 3, visits7d: 0 })).toBe(false);
    expect(isStagnating({ ratings7d: 0, visits7d: 5 })).toBe(false);
    expect(isStagnating(null)).toBe(false);
  });

  it('reports the stagnating share', () => {
    const r = stagnationReport([{ userId: 'a', ratings7d: 0, visits7d: 0 }, { userId: 'b', ...active }]);
    expect(r).toMatchObject({ users: 2, stagnating: 1, share: 0.5, flaggedIds: ['a'] });
    expect(stagnationReport([]).share).toBeNull();
  });
});

describe('novelty score', () => {
  it('novelty by times seen: 1.0, 0.7, 0.2', () => {
    expect([0, 1, 2, 9, undefined].map((n) => novelty(n))).toEqual([1, 0.7, 0.2, 0.2, 1]);
  });

  it('unexpectedness from 1 - cosine(profile, tags)', () => {
    const profile = { art: 0.8, food: 0.3, nature: 0.1 };
    expect(tagCosine(profile, ['art'])).toBeCloseTo(0.8 / Math.sqrt(0.74), 6);
    expect(unexpectedness(profile, ['art'])).toBe(0.3); // usual
    expect(unexpectedness(profile, ['nature'])).toBe(1); // very different
    expect(unexpectedness(profile, ['food'])).toBe(1);
    expect(unexpectedness({ art: 1.2, food: 1 }, ['food'])).toBe(0.6); // contradiction 0.36
    expect(unexpectedness({}, ['art'])).toBe(1);
  });

  it('quality = 0.7 * avg/5 + 0.3 * min(count/100, 1)', () => {
    expect(quality({ avg: 5, count: 200 })).toBeCloseTo(1, 10);
    expect(quality({ avg: 4, count: 50 })).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.5, 10);
    expect(quality(null)).toBeCloseTo(0.7 * 0.6, 10); // neutral prior, no reviews
  });

  it('weights 0.5 novelty + 0.3 unexpectedness + 0.2 quality', () => {
    const r = noveltyScore({ timesSeen: 0, profile: { art: 1 }, tags: ['food'], rating: { avg: 5, count: 100 } });
    expect(r.score).toBeCloseTo(0.5 + 0.3 + 0.2, 10);
    expect(noveltyScore({ timesSeen: 2, profile: { art: 1 }, tags: ['art'], rating: { avg: 5, count: 100 } }).score).toBeCloseTo(0.1 + 0.09 + 0.2, 10);
  });
});

describe('explorationSet', () => {
  const place = (id, cats, extra = {}) => ({ id, region: 'milan', categories: cats, distanceMeters: 100, ...extra });
  const candidates = [
    place('seen', ['food']),
    place('art1', ['art-museums']),
    place('park', ['parks-nature']),
    place('bad', ['parks-nature']),
    place('top', ['food']),
    place('trend', ['food']),
  ];
  const opts = {
    candidates,
    exclude: new Set(['milan/top']),
    seenOf: (p) => (p.id === 'seen' ? 3 : 0),
    profileOf: () => ({ food: 10 }),
    ratingOf: (p) => (p.id === 'bad' ? { avg: 2.1, count: 40 } : { avg: 4.5, count: 30 }),
    trendOf: (p) => (p.id === 'trend' ? 12 : 0),
  };

  it('never repeats exploitation picks or explores a known-bad place', () => {
    const ids = explorationSet(opts).map((p) => p.id);
    expect(ids).not.toContain('top');
    expect(ids).not.toContain('bad');
  });

  it('ranks unseen, atypical places above seen, typical ones and marks the bucket', () => {
    const set = explorationSet(opts);
    expect(set[set.length - 1].id).toBe('seen');
    expect(set.every((p) => p.explore === true && p.noveltyScore > 0 && p.noveltyScore <= 1)).toBe(true);
    expect(new Set(set.map((p) => p.exploreBucket)).has('never-seen')).toBe(true);
  });

  it('keeps trending places in the set via their bucket', () => {
    const set = explorationSet({ ...opts, size: 3 });
    expect(set.map((p) => p.id)).toContain('trend');
  });

  it('caps the set size (20 by default)', () => {
    const many = Array.from({ length: 60 }, (_, i) => place(`p${i}`, ['food']));
    expect(explorationSet({ ...opts, candidates: many })).toHaveLength(EXPLORATION.exploreSetSize);
  });

  it('keeps average novelty of picks above 0.6 for fresh candidates', () => {
    const fresh = Array.from({ length: 30 }, (_, i) => place(`p${i}`, [i % 2 ? 'art-museums' : 'parks-nature']));
    const set = explorationSet({ ...opts, candidates: fresh, seenOf: () => 0 });
    expect(set.reduce((s, p) => s + p.noveltyScore, 0) / set.length).toBeGreaterThan(0.6);
  });

  it('builds a 20-place set from 500 candidates in under 20 ms', () => {
    const big = Array.from({ length: 500 }, (_, i) => place(`b${i}`, [['food', 'art-museums', 'parks-nature'][i % 3]]));
    explorationSet({ ...opts, candidates: big });
    const t0 = performance.now();
    explorationSet({ ...opts, candidates: big });
    expect(performance.now() - t0).toBeLessThan(20);
  });
});

describe('assignSlots', () => {
  it('explores about epsilon of all slots (80/20 within ±5%)', () => {
    const rng = seededRandom(42);
    let explore = 0;
    let total = 0;
    for (let i = 0; i < 2500; i++) {
      const s = assignSlots(4, 0.2, rng);
      explore += s.filter((x) => x === 'explore').length;
      total += s.length;
    }
    expect(Math.abs(explore / total - 0.2)).toBeLessThan(0.05);
  });

  it('handles 0 and negative counts', () => {
    expect(assignSlots(0, 0.5)).toEqual([]);
    expect(assignSlots(-1, 0.5)).toEqual([]);
  });
});
