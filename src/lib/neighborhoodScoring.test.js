import { describe, it, expect } from 'vitest';
import { logScale, scoreNeighborhoods } from './neighborhoodScoring';

describe('logScale', () => {
  it('puts the lowest at 0 and the highest at 5', () => {
    const vals = [0, 10, 100, 1000];
    expect(logScale(0, vals)).toBe(0);
    expect(logScale(1000, vals)).toBe(5);
    const mid = logScale(100, vals);
    expect(mid).toBeGreaterThan(2.5);
    expect(mid).toBeLessThan(5);
  });

  it('null stays null, and nulls are ignored in the range', () => {
    expect(logScale(null, [1, 2])).toBeNull();
    expect(logScale(2, [null, 1, 2])).toBe(5);
  });
});

describe('scoreNeighborhoods', () => {
  const metrics = {
    Dense: { restaurants: 400, cuisines: ['a', 'b', 'c', 'd'], nightlife: 80, shopping: 600, artAndCulture: 40, walkable: 2000, medianHomeValue: 900000 },
    Quiet: { restaurants: 5, cuisines: ['a'], nightlife: 0, shopping: 10, artAndCulture: 0, walkable: 50, medianHomeValue: 300000 },
    NoTract: { restaurants: 50, cuisines: [], nightlife: 5, shopping: 100, artAndCulture: 3, walkable: 400, medianHomeValue: null },
  };
  const s = scoreNeighborhoods(metrics);

  it('fills every slider but Safety and Price', () => {
    expect(s.Dense).toEqual({
      safety: null,
      walkability: 5,
      restaurants: { quantity: 5, price: null, diversity: 5 },
      nightlife: 5,
      averagePropertyPrice: 5,
      artAndCulture: 5,
      shopping: 5,
    });
    expect(s.Quiet.walkability).toBe(0);
    expect(s.Quiet.averagePropertyPrice).toBe(0);
  });

  it('a missing home value stays null', () => {
    expect(s.NoTract.averagePropertyPrice).toBeNull();
    expect(s.NoTract.restaurants.quantity).toBeGreaterThan(0);
  });
});
