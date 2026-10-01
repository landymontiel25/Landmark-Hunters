import { describe, it, expect } from 'vitest';
import { predictLevel } from './maprPrediction';

const NOW = Date.UTC(2026, 5, 1);
const profile = (scores, counts, region = 'villanova') => ({
  tagScores: { [region]: scores },
  tagScoresAt: { [region]: {} },
  tagCounts: { [region]: counts },
});
const base = profile({ food: 60, history: -40, 'parks-nature': 6, sports: 50 }, { food: 6, history: 4, 'parks-nature': 3, sports: 1 });
const at = (tags, p = base) => predictLevel({ profile: p, region: 'villanova', tags, nowMs: NOW });

describe('predictLevel', () => {
  it('positive when the place tags average well above the user range', () => {
    expect(at(['food'])).toBe('positive'); // 60/60 = 1
  });
  it('negative when they average well below zero', () => {
    expect(at(['history'])).toBe('negative'); // -40/60 = -0.67
  });
  it('neutral in between', () => {
    expect(at(['parks-nature'])).toBe('neutral'); // 6/60 = 0.1
    expect(at(['food', 'history'])).toBe('neutral'); // mean 10 -> 0.17
  });
  it('averages only tags with enough ratings behind them', () => {
    expect(at(['sports'])).toBeNull(); // 1 rating: not evidence
    expect(at(['sports', 'food'])).toBe('positive'); // sports ignored, food counts
  });
  it('null with too little data', () => {
    expect(at([])).toBeNull();
    expect(at(['unknown-tag'])).toBeNull();
    expect(at(['food'], profile({ food: 60 }, { food: 4 }))).toBeNull(); // 4 ratings in all, under 5
    expect(at(['food'], null)).toBeNull();
    expect(predictLevel({ profile: base, region: null, tags: ['food'] })).toBeNull();
  });
  it('a tiny score range is not blown up (scale floor)', () => {
    expect(at(['food'], profile({ food: 4 }, { food: 6 }))).toBe('positive'); // 4/10 = 0.4
    expect(at(['food'], profile({ food: 2 }, { food: 6 }))).toBe('neutral'); // 0.2 < cutoff
  });
  it('counts ratings from other regions toward tag evidence', () => {
    const p = { tagScores: { villanova: { food: 30 } }, tagScoresAt: {}, tagCounts: { villanova: { food: 1 }, miami: { food: 5 } } };
    expect(at(['food'], p)).toBe('positive');
  });
});
