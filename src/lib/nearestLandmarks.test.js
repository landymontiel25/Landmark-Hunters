import { describe, it, expect } from 'vitest';
import { nearestLandmarks } from './nearestLandmarks';

const L = [
  { id: 'far', name: 'Far', lat: 40.0, lng: -75.0 },
  { id: 'near', name: 'Near', lat: 39.95, lng: -75.15 },
  { id: 'mid', name: 'Mid', lat: 39.96, lng: -75.16 },
  { id: 'nocoords', name: 'None' },
];

describe('nearestLandmarks', () => {
  it('sorts by distance, skips places without coordinates, and trims to count', () => {
    const out = nearestLandmarks({ lat: 39.95, lng: -75.15 }, 2, L);
    expect(out.map((r) => r.landmark.id)).toEqual(['near', 'mid']);
    expect(out[0].meters).toBeLessThan(1);
    expect(out[1].meters).toBeGreaterThan(1000);
  });
  it('returns nothing without a usable origin', () => {
    expect(nearestLandmarks(null, 3, L)).toEqual([]);
    expect(nearestLandmarks({ lat: 'x', lng: 1 }, 3, L)).toEqual([]);
  });
});
