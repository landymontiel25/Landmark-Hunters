import { describe, expect, it } from 'vitest';
import { haversineKm, haversineMeters } from './haversine.js';

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(25.76, -80.19, 25.76, -80.19)).toBe(0);
  });

  it('measures Miami to Philadelphia at about 1,640 km', () => {
    const km = haversineKm(25.7617, -80.1918, 39.9526, -75.1652);
    expect(km).toBeGreaterThan(1630);
    expect(km).toBeLessThan(1650);
  });

  it('gives km as meters / 1000 and is symmetric', () => {
    const m = haversineMeters(10, 20, 11, 21);
    expect(haversineKm(10, 20, 11, 21)).toBeCloseTo(m / 1000, 9);
    expect(haversineMeters(11, 21, 10, 20)).toBeCloseTo(m, 6);
  });
});
