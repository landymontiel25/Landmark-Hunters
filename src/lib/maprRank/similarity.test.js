import { describe, it, expect } from 'vitest';
import {
  blendSimilarity,
  collabBoost,
  computeRegionSimilarity,
  decodeNeighbors,
  encodeNeighbors,
  jaccard,
  landmarkFeatures,
  lookupSimilarity,
  setCosine,
} from './similarity.js';
import { COLLAB_MAX_BOOST, SIMILAR_TOP_K } from './config.js';

const NOW = Date.parse('2026-10-01T00:00:00Z');
const DAY = 86400000;
const lm = (id, feats) => ({ id, features: new Set(feats) });
const visit = (userId, landmarkId, daysAgo = 1) => ({ userId, landmarkId, at: NOW - daysAgo * DAY });

describe('jaccard', () => {
  it('is co_visitors / (A + B - co)', () => {
    expect(jaccard(2, 4, 3)).toBeCloseTo(2 / 5, 10);
    expect(jaccard(3, 3, 3)).toBe(1);
  });
  it('is 0 with no co-visitors or no visitors', () => {
    expect(jaccard(0, 5, 5)).toBe(0);
    expect(jaccard(0, 0, 0)).toBe(0);
  });
});

describe('setCosine', () => {
  it('is |A∩B| / sqrt(|A||B|) for binary vectors', () => {
    expect(setCosine(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(0.5, 10);
    expect(setCosine(new Set(['a']), new Set(['a']))).toBe(1);
    expect(setCosine(new Set(['a']), new Set(['b']))).toBe(0);
    expect(setCosine(new Set(), new Set(['b']))).toBe(0);
  });
});

it('blends 0.6 * jaccard + 0.4 * cosine', () => {
  expect(blendSimilarity(0.5, 1)).toBeCloseTo(0.7, 10);
});

describe('computeRegionSimilarity', () => {
  const landmarks = [lm('a', ['c:art']), lm('b', ['c:art']), lm('c', ['c:food']), lm('d', ['c:food', 'k:sushi'])];

  it('scores a co-visited pair with both parts', () => {
    const visits = [visit('u1', 'a'), visit('u1', 'b'), visit('u2', 'a'), visit('u3', 'b')];
    const { neighbors } = computeRegionSimilarity({ visits, landmarks, now: NOW });
    // a: {u1,u2}, b: {u1,u3}, co = 1 -> jaccard 1/3; cosine 1.
    expect(lookupSimilarity(neighbors, 'a', 'b')).toBeCloseTo(0.6 / 3 + 0.4, 4);
  });

  it('gives a new landmark with no co-visitors its feature similarity only', () => {
    const { neighbors } = computeRegionSimilarity({ visits: [visit('u1', 'c')], landmarks, now: NOW });
    expect(lookupSimilarity(neighbors, 'c', 'd')).toBeCloseTo(0.4 * (1 / Math.sqrt(2)), 4);
    expect(lookupSimilarity(neighbors, 'c', 'a')).toBe(0);
  });

  it('handles a single visitor', () => {
    const { neighbors, stats } = computeRegionSimilarity({ visits: [visit('solo', 'a'), visit('solo', 'c')], landmarks, now: NOW });
    expect(stats.visitors).toBe(1);
    // co 1, A 1, C 1 -> jaccard 1; cosine 0.
    expect(lookupSimilarity(neighbors, 'a', 'c')).toBeCloseTo(0.6, 4);
  });

  it('ignores check-ins older than 90 days and places outside the region', () => {
    const { neighbors } = computeRegionSimilarity({ visits: [visit('u1', 'a', 120), visit('u1', 'c', 120), visit('u1', 'zz')], landmarks, now: NOW });
    expect(neighbors.a).toBeUndefined();
    expect(lookupSimilarity(neighbors, 'a', 'c')).toBe(0);
  });

  it('gives rows to liked-without-visit landmarks (rowOwners)', () => {
    const { neighbors } = computeRegionSimilarity({ visits: [], landmarks, rowOwners: ['a', 'nope'], now: NOW });
    expect(Object.keys(neighbors)).toEqual(['a']);
  });

  it('keeps only the top 20 per landmark, best first', () => {
    const many = Array.from({ length: 60 }, (_, i) => lm(`x${i}`, ['c:art', ...(i % 3 === 0 ? ['k:mod'] : [])]));
    const visits = many.map((l, i) => visit(`u${i % 7}`, l.id));
    const { neighbors } = computeRegionSimilarity({ visits, landmarks: many, now: NOW });
    for (const row of Object.values(neighbors)) {
      expect(row.length).toBeLessThanOrEqual(SIMILAR_TOP_K);
      for (let i = 1; i < row.length; i++) expect(row[i][1]).toBeLessThanOrEqual(row[i - 1][1]);
      for (const [, s] of row) {
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('computes 500 landmarks x 20 neighbors well inside 10 minutes', () => {
    const cats = ['art', 'food', 'parks', 'history', 'night'];
    const ls = Array.from({ length: 500 }, (_, i) => lm(`l${i}`, [`c:${cats[i % 5]}`, `k:k${i % 17}`]));
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const visits = Array.from({ length: 5000 }, () => visit(`u${Math.floor(rand() * 300)}`, `l${Math.floor(rand() * 500)}`, rand() * 80));
    const t0 = Date.now();
    const { neighbors, stats } = computeRegionSimilarity({ visits, landmarks: ls, now: NOW });
    const ms = Date.now() - t0;
    expect(stats.rows).toBeGreaterThan(400);
    expect(Object.values(neighbors).every((r) => r.length === SIMILAR_TOP_K)).toBe(true);
    expect(ms).toBeLessThan(10 * 60 * 1000);
    expect(ms).toBeLessThan(10_000); // and in practice, seconds
  });
});

describe('encode / decode', () => {
  it('round-trips', () => {
    const n = { a: [['b', 0.5]], c: [['a', 0.1]] };
    const { json, keptPerRow } = encodeNeighbors(n);
    expect(keptPerRow).toBe(1);
    expect(decodeNeighbors(json)).toEqual(n);
  });

  it('trims the weakest neighbors until it fits', () => {
    const n = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`id${i}`, Array.from({ length: 20 }, (_, j) => [`n${j}`, 1 - j / 100])]));
    const full = JSON.stringify(n).length;
    const { json, keptPerRow } = encodeNeighbors(n, Math.floor(full / 2));
    expect(json.length).toBeLessThanOrEqual(Math.floor(full / 2));
    expect(keptPerRow).toBeLessThan(20);
    expect(decodeNeighbors(json).id0[0]).toEqual(['n0', 1]);
  });

  it('decodes garbage to an empty matrix', () => {
    expect(decodeNeighbors('{oops')).toEqual({});
    expect(decodeNeighbors('[1,2]')).toEqual({});
    expect(decodeNeighbors(null)).toEqual({});
  });
});

describe('collabBoost', () => {
  const neighbors = { duomo: [['cathedral', 0.8], ['park', 0.1]], museo: [['cathedral', 0.5]] };

  it('matches the spec example: similarity 0.8 -> +16%', () => {
    const boost = collabBoost(neighbors, 'cathedral', ['duomo']);
    expect(boost).toBeCloseTo(0.16, 10);
    // base 0.7 * 1.2 = 0.84 -> 0.84 * 1.16
    expect(0.84 * (1 + boost)).toBeCloseTo(0.9744, 4);
  });

  it('caps the total at +20%', () => {
    expect(collabBoost(neighbors, 'cathedral', ['duomo', 'museo'])).toBe(COLLAB_MAX_BOOST);
  });

  it('reads either direction of the sparse matrix', () => {
    expect(collabBoost(neighbors, 'duomo', ['cathedral'])).toBeCloseTo(0.16, 10);
  });

  it('is 0 with no liked places, no matrix, or only itself liked', () => {
    expect(collabBoost(neighbors, 'cathedral', [])).toBe(0);
    expect(collabBoost(null, 'cathedral', ['duomo'])).toBe(0);
    expect(collabBoost(neighbors, 'duomo', ['duomo'])).toBe(0);
  });
});

it('landmarkFeatures: categories and kinds', () => {
  const f = landmarkFeatures({ categories: ['food', 'local-life'] }, () => new Set(['sushi']));
  expect([...f].sort()).toEqual(['c:food', 'c:local-life', 'k:sushi']);
});
