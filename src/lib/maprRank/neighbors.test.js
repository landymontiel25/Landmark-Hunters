import { describe, it, expect } from 'vitest';
import { agreement, cosine, isNeighbor, neighborScore, neighborScoreOf, NEIGHBOR_FLOOR, rankNeighbors, tasteMatchLabel, tasteSim, tasteVector } from './neighbors.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');

describe('step 1: taste vector', () => {
  it('is effectiveTagScores / 100, with the 1.5x lean-into-it boost', () => {
    const profile = { tagScores: { philly: { food: 80, parks: -40 } }, tagScoresAt: { philly: { food: NOW, parks: NOW } }, capAnswers: { food: 'yes' } };
    const v = tasteVector(profile, 'philly', NOW);
    expect(v.food).toBeCloseTo(1.2, 5);
    expect(v.parks).toBeCloseTo(-0.4, 5);
  });
  it('overall (no region) averages every city at full weight', () => {
    const profile = { tagScores: { philly: { food: 60 }, miami: { food: 20 } }, tagScoresAt: { philly: { food: NOW }, miami: { food: NOW } } };
    expect(tasteVector(profile, null, NOW).food).toBeCloseTo(0.4, 5);
  });
});

describe('step 2: taste similarity', () => {
  it('is the cosine, shrunk below 10 ratings on either side', () => {
    const a = { food: 1, parks: 0 };
    expect(cosine(a, { food: 1 })).toBeCloseTo(1, 5);
    expect(cosine({ food: 1 }, { parks: 1 })).toBe(0);
    expect(cosine({ food: 1 }, { food: -1 })).toBeCloseTo(-1, 5);
    expect(tasteSim({ food: 1 }, { food: 1 }, 10, 20)).toBeCloseTo(1, 5);
    expect(tasteSim({ food: 1 }, { food: 1 }, 5, 10)).toBeCloseTo(0.5, 5);
    expect(tasteSim({ food: 1 }, { food: 1 }, 2, 5)).toBeCloseTo(0.1, 5);
    expect(tasteSim({}, { food: 1 }, 10, 10)).toBe(0);
  });
});

describe('step 3: rating agreement', () => {
  it('scores same 1, adjacent 0.5, opposite 0, needs 3 shared, shrinks below 10', () => {
    const a = { p1: 'highly-recommend', p2: 'worth-trying', p3: 'probably-skip', p4: 'highly-recommend' };
    const b = { p1: 'highly-recommend', p2: 'highly-recommend', p3: 'highly-recommend', p9: 'probably-skip' };
    // (1 + 0.5 + 0) / 3 = 0.5, times 3/10
    expect(agreement(a, b)).toBeCloseTo(0.15, 5);
    expect(agreement({ p1: 'highly-recommend', p2: 'worth-trying' }, { p1: 'highly-recommend', p2: 'worth-trying' })).toBeNull();
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, 'worth-trying']));
    expect(agreement(ten, ten)).toBeCloseTo(1, 5);
  });
});

describe('step 4: neighbor score and the 0.3 floor', () => {
  it('is 0.6 taste + 0.4 agreement, or taste alone with no shared places', () => {
    expect(neighborScore(0.5, 1)).toBeCloseTo(0.7, 5);
    expect(neighborScore(0.5, null)).toBe(0.5);
  });
  it('counts a person only at 0.3 or more', () => {
    expect(NEIGHBOR_FLOOR).toBe(0.3);
    expect(isNeighbor(0.3)).toBe(true);
    expect(isNeighbor(0.2999)).toBe(false);
    expect(isNeighbor(NaN)).toBe(false);
  });
  it('labels High at 0.6, Some from 0.3, nothing below, never a number', () => {
    expect(tasteMatchLabel(0.6)).toBe('High');
    expect(tasteMatchLabel(0.45)).toBe('Some');
    expect(tasteMatchLabel(0.29)).toBeNull();
    expect(tasteMatchLabel(null)).toBeNull();
  });
});

describe('rankNeighbors and neighborScoreOf', () => {
  const people = {
    me: { vector: { food: 1, parks: 0.5 }, ratings: 20, tiers: {} },
    twin: { vector: { food: 1, parks: 0.5 }, ratings: 20, tiers: {} },
    near: { vector: { food: 1, parks: -0.2 }, ratings: 20, tiers: {} },
    opposite: { vector: { food: -1 }, ratings: 20, tiers: {} },
    newbie: { vector: { food: 1, parks: 0.5 }, ratings: 2, tiers: {} },
    blocked: { vector: { food: 1, parks: 0.5 }, ratings: 20, tiers: {} },
  };
  it('keeps people at or above the floor, best first, skipping blocks and yourself', () => {
    const out = rankNeighbors('me', people, Object.keys(people), { skip: (u) => u === 'blocked' });
    expect(out.map((n) => n.uid)).toEqual(['twin', 'near']);
    expect(out[0].score).toBeCloseTo(1, 3);
  });
  it('a dad with different taste is not paired', () => {
    expect(rankNeighbors('me', people, ['opposite'])).toEqual([]);
  });
  it('reads the city list first, then the overall one', () => {
    const doc = { global: [{ uid: 'a', score: 0.4 }], byRegion: { philly: [{ uid: 'a', score: 0.7 }] } };
    expect(neighborScoreOf(doc, 'a', 'philly')).toBe(0.7);
    expect(neighborScoreOf(doc, 'a', 'miami')).toBe(0.4);
    expect(neighborScoreOf(doc, 'b', 'philly')).toBeNull();
    expect(neighborScoreOf(null, 'a')).toBeNull();
  });
});
