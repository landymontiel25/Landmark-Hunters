import { describe, it, expect } from 'vitest';
import { applyDecay, decayMultiplier, haversineKm } from './distanceDecay.js';
import { DECAY_DISTANCE_KM } from './config.js';
import { distanceMeters } from '../geo.js';

describe('decayMultiplier: 1 / (1 + km / 1.5)', () => {
  it.each([
    [0, 1],
    [0.5, 0.75],
    [1, 0.6],
    [1.5, 0.5],
    [3, 1 / 3],
    [5, 1 / (1 + 5 / 1.5)],
    [15, 1 / 11],
  ])('%s km -> %s', (km, expected) => {
    expect(decayMultiplier(km)).toBeCloseTo(expected, 10);
  });

  it('uses 1.5 km as the half-way point', () => {
    expect(DECAY_DISTANCE_KM).toBe(1.5);
    expect(decayMultiplier(DECAY_DISTANCE_KM)).toBe(0.5);
  });

  it('is strictly decreasing with distance', () => {
    const ks = [0, 0.1, 0.5, 1, 2, 5, 10, 50, 200];
    const ms = ks.map((k) => decayMultiplier(k));
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeLessThan(ms[i - 1]);
  });

  it('treats 0, negative, NaN and missing distances as "at the place" (x1)', () => {
    for (const d of [0, -3, NaN, null, undefined, Infinity * -1]) expect(decayMultiplier(d)).toBe(1);
  });

  it('stays positive and finite far away (over 10 km)', () => {
    for (const d of [10.1, 100, 20000]) {
      const m = decayMultiplier(d);
      expect(m).toBeGreaterThan(0);
      expect(Number.isFinite(m)).toBe(true);
    }
  });

  it('falls back to the configured half-way point for a bad decay distance', () => {
    expect(decayMultiplier(1.5, 0)).toBe(0.5);
    expect(decayMultiplier(1.5, -2)).toBe(0.5);
  });
});

describe('applyDecay', () => {
  it('scales positive scores down with distance', () => {
    expect(applyDecay(30, 1.5)).toBe(15);
    expect(applyDecay(30, 0)).toBe(30);
  });

  it('keeps nearer better for negative scores (divides instead of multiplies)', () => {
    expect(applyDecay(-10, 1.5)).toBe(-20);
    expect(applyDecay(-10, 0.1)).toBeGreaterThan(applyDecay(-10, 5));
  });

  it('leaves zero at zero and treats a missing score as zero', () => {
    expect(applyDecay(0, 3)).toBe(0);
    expect(applyDecay(undefined, 3)).toBe(0);
  });
});

describe('haversineKm', () => {
  it.each([
    // Known great-circle distances (mean Earth radius 6371 km).
    ['Paris -> London', [48.8566, 2.3522, 51.5074, -0.1278], 343.5, 1],
    ['JFK -> LAX', [40.6413, -73.7781, 33.9416, -118.4085], 3974.3, 1],
    ['Milan Duomo -> Castello Sforzesco', [45.4642, 9.19, 45.4705, 9.1793], 1.07, 0.05],
    ['Equator, one degree of longitude', [0, 0, 0, 1], 111.195, 0.01],
  ])('%s', (_name, [a, b, c, d], km, tol) => {
    expect(Math.abs(haversineKm(a, b, c, d) - km)).toBeLessThan(tol);
  });

  it('is 0 for the same point and symmetric', () => {
    expect(haversineKm(45, 9, 45, 9)).toBe(0);
    expect(haversineKm(45, 9, 41, 2)).toBeCloseTo(haversineKm(41, 2, 45, 9), 9);
  });

  it('agrees with the app\'s existing distanceMeters', () => {
    expect(haversineKm(25.76, -80.19, 25.69, -80.16) * 1000).toBeCloseTo(distanceMeters(25.76, -80.19, 25.69, -80.16), 6);
  });

  it('returns NaN for missing coordinates', () => {
    expect(haversineKm(1, 2, null, 4)).toBeNaN();
  });
});
