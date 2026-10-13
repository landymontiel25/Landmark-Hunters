import { describe, it, expect } from 'vitest';
import { applyCommunity, communityWeight, finderWeight, freshness, GATE, gateMet, gateOpen, gateStreak, placeFinderWeight, ramp, visitAgeDays } from './community.js';

describe('step 5: finder weight', () => {
  it('a taste neighbor counts 1 + 0.6 x score, only at 0.3 or more', () => {
    expect(finderWeight({ neighborScore: 0.5 })).toBeCloseTo(1.3, 5);
    expect(finderWeight({ neighborScore: 1 })).toBeCloseTo(1.6, 5);
    expect(finderWeight({ neighborScore: 0.29 })).toBe(1);
  });
  it('someone you follow 1.4, a friend 1.3, reputation 1 + 0.5 x it, the strongest wins', () => {
    expect(finderWeight({ follows: true })).toBe(1.4);
    expect(finderWeight({ friend: true })).toBe(1.3);
    expect(finderWeight({ reputation: 0.8 })).toBeCloseTo(1.4, 5);
    expect(finderWeight({ follows: true, neighborScore: 0.9 })).toBeCloseTo(1.54, 5);
    expect(finderWeight({})).toBe(1);
  });
  it('a place takes the best finder plus 0.1 per extra finder (max +0.3), capped at 2.0', () => {
    expect(placeFinderWeight([])).toBe(1);
    expect(placeFinderWeight([1.4])).toBe(1.4);
    expect(placeFinderWeight([1.4, 1, 1])).toBeCloseTo(1.6, 5);
    expect(placeFinderWeight([1.4, 1, 1, 1, 1, 1])).toBeCloseTo(1.7, 5);
    expect(placeFinderWeight([1.6, 1.6, 1.6, 1.6])).toBeCloseTo(1.9, 5);
    expect(placeFinderWeight([1.9, 1.9, 1.9])).toBe(2);
  });
});

describe('step 6: freshness', () => {
  it('1.0 to 30 days, 0.7 at 180, 0.5 at a year and after', () => {
    expect(freshness(0)).toBe(1);
    expect(freshness(30)).toBe(1);
    expect(freshness(105)).toBeCloseTo(0.85, 5);
    expect(freshness(180)).toBeCloseTo(0.7, 5);
    expect(freshness(365)).toBeCloseTo(0.5, 5);
    expect(freshness(2000)).toBe(0.5);
  });
  it('reads a visit month as its middle day', () => {
    expect(visitAgeDays('2026-10', Date.UTC(2026, 9, 15))).toBe(0);
    expect(visitAgeDays('2026-09', Date.UTC(2026, 9, 15))).toBe(30);
    expect(visitAgeDays('bad')).toBeNull();
  });
});

describe('step 7: ramp and community weight', () => {
  it('the ramp is the lowest of 1, users / 100 and tips / 150', () => {
    expect(ramp({ activeUsers: 0, liveTips: 0 })).toBe(0);
    expect(ramp({ activeUsers: 50, liveTips: 75 })).toBe(0.5);
    expect(ramp({ activeUsers: 100, liveTips: 5 })).toBeCloseTo(5 / 150, 5);
    expect(ramp({ activeUsers: 500, liveTips: 900 })).toBe(1);
  });
  it('week 1 is Mapr only; half the ramp gives half the pull; the cap applies before the ramp', () => {
    expect(communityWeight(1.6, 0)).toBe(1);
    expect(communityWeight(1.6, 0.5)).toBeCloseTo(1.3, 5);
    expect(communityWeight(3, 1)).toBe(2);
    expect(communityWeight(1.6, 1, 0.5)).toBeCloseTo(1.3, 5);
  });
  it('lifts a positive score, never sinks a negative one further', () => {
    expect(applyCommunity(10, 1.5)).toBe(15);
    expect(applyCommunity(-10, 1.5)).toBeCloseTo(-6.667, 2);
    expect(applyCommunity(10, 1)).toBe(10);
  });
});

describe('density gate', () => {
  it('needs all three numbers, 14 days in a row', () => {
    const ok = { discoverers30: 30, liveTipPlaces: 150, medianNearby: 5 };
    expect(gateMet(ok)).toBe(true);
    expect(gateMet({ ...ok, medianNearby: 4 })).toBe(false);
    expect(gateStreak({ date: '2026-10-11', gateStreakDays: 13 }, true, '2026-10-12')).toBe(14);
    expect(gateStreak({ date: '2026-10-11', gateStreakDays: 13 }, false, '2026-10-12')).toBe(0);
    expect(gateStreak({ date: '2026-10-12', gateStreakDays: 5 }, true, '2026-10-12')).toBe(5);
    // A missed night starts the run over.
    expect(gateStreak({ date: '2026-10-09', gateStreakDays: 13 }, true, '2026-10-12')).toBe(1);
    expect(gateStreak(null, true, '2026-10-12')).toBe(1);
    expect(gateOpen(GATE.days)).toBe(true);
    expect(gateOpen(13)).toBe(false);
  });
});
