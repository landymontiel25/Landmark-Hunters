import { describe, it, expect } from 'vitest';
import {
  periodKeys,
  taperedPoints,
  isRealCheckin,
  HOME_RADIUS_METERS,
  HOME_RADIUS_EXCLUSION_ENABLED,
  shouldPromptLoveReason,
} from './leaderboard';

describe('periodKeys', () => {
  it('computes matching weekly/monthly/yearly keys for a known date', () => {
    // 2026-03-04 is a Wednesday in ISO week 10 of 2026.
    const keys = periodKeys(new Date(Date.UTC(2026, 2, 4)));
    expect(keys).toEqual({ weekly: '2026-W10', monthly: '2026-03', yearly: '2026' });
  });

  it('keeps the same weekly key across a Mon-Sun span', () => {
    // ISO weeks run Monday-Sunday. 2026-03-02 (Mon) through 2026-03-08 (Sun)
    // is one ISO week -- ISO week 10.
    const monday = periodKeys(new Date(Date.UTC(2026, 2, 2)));
    const sunday = periodKeys(new Date(Date.UTC(2026, 2, 8)));
    expect(monday.weekly).toBe(sunday.weekly);
  });

  it('rolls the monthly/yearly keys over on Jan 1', () => {
    const keys = periodKeys(new Date(Date.UTC(2027, 0, 1)));
    expect(keys.monthly).toBe('2027-01');
    expect(keys.yearly).toBe('2027');
  });
});

describe('taperedPoints', () => {
  it('pays full points on the first visit', () => {
    expect(taperedPoints(100, 1)).toBe(100);
  });

  it('pays nothing from the 2nd visit on', () => {
    expect(taperedPoints(100, 2)).toBe(0);
    expect(taperedPoints(100, 5)).toBe(0);
    expect(taperedPoints(100, 50)).toBe(0);
  });
});

describe('HOME_RADIUS_METERS', () => {
  it('is 0.5 miles', () => {
    expect(HOME_RADIUS_METERS).toBeCloseTo(804.672, 2);
  });

  it('exclusion is currently toggled off', () => {
    expect(HOME_RADIUS_EXCLUSION_ENABLED).toBe(false);
  });
});

describe('isRealCheckin', () => {
  it('is false for a ratingOnly claim, whatever its points', () => {
    expect(isRealCheckin({ ratingOnly: true, points: 0 })).toBe(false);
    expect(isRealCheckin({ ratingOnly: true, points: 100 })).toBe(false);
  });

  it('trusts the explicit visited flag when present, even at 0 points', () => {
    expect(isRealCheckin({ visited: true, points: 0 })).toBe(true);
    expect(isRealCheckin({ visited: false, points: 100 })).toBe(false);
  });

  it('falls back to the points heuristic for legacy data with neither field', () => {
    expect(isRealCheckin({ points: 100 })).toBe(true);
    expect(isRealCheckin({ points: 0 })).toBe(false);
  });
});

describe('shouldPromptLoveReason', () => {
  it('fires on the 3rd visit', () => {
    expect(shouldPromptLoveReason(3)).toBe(true);
  });

  it('never fires before the 3rd visit', () => {
    expect(shouldPromptLoveReason(1)).toBe(false);
    expect(shouldPromptLoveReason(2)).toBe(false);
  });

  it('repeats every 10th visit after the 3rd (13th, 23rd, 33rd)', () => {
    expect(shouldPromptLoveReason(13)).toBe(true);
    expect(shouldPromptLoveReason(23)).toBe(true);
    expect(shouldPromptLoveReason(33)).toBe(true);
  });

  it('stays quiet on every other visit', () => {
    expect(shouldPromptLoveReason(4)).toBe(false);
    expect(shouldPromptLoveReason(12)).toBe(false);
    expect(shouldPromptLoveReason(14)).toBe(false);
  });
});
