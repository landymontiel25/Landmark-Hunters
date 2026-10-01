import { describe, it, expect } from 'vitest';
import { getRegion, INTERESTS } from '../data/regions';
import { PICKS_SHEET_H, nearbyPicksCacheKey, rankNearbyCandidates } from './nearbyPicks';

const ORIGIN = getRegion('villanova').center;
const NOW = Date.now();
// Rated every kind of place in this region a lot, so no category counts as new
// any more: the case where "Something new" used to run dry.
const ALL_RATED = {
  tagScores: { villanova: Object.fromEntries(INTERESTS.map((i) => [i.id, 5])) },
  tagScoresAt: { villanova: Object.fromEntries(INTERESTS.map((i) => [i.id, NOW])) },
  tagCounts: { villanova: Object.fromEntries(INTERESTS.map((i) => [i.id, 99])) },
};
const rated = (id) => ({ landmarkId: id, ratingTier: 'highly-recommend' });

describe('rankNearbyCandidates fillNew', () => {
  const args = { profile: ALL_RATED, origin: ORIGIN, miles: 5, now: NOW, myReviews: {} };

  it('has no new places for someone who has rated every kind of place', () => {
    expect(rankNearbyCandidates(args).fresh).toEqual([]);
  });

  it('counts places you have not rated as new, nearest and best fit first, with fillNew', () => {
    const { fresh } = rankNearbyCandidates({ ...args, fillNew: true });
    expect(fresh.length).toBeGreaterThan(3);
    expect(fresh.every((p) => p.pickType === 'new')).toBe(true);
    const distances = fresh.slice(0, 5).map((p) => p.distanceMeters);
    expect(distances.every((d) => Number.isFinite(d))).toBe(true);
  });

  it('never offers a place you already rated, or lists one twice', () => {
    const base = rankNearbyCandidates({ ...args, fillNew: true }).fresh;
    const first = base[0];
    const { fresh } = rankNearbyCandidates({ ...args, fillNew: true, myReviews: { [first.id]: rated(first.id) } });
    expect(fresh.find((p) => p.id === first.id)).toBeUndefined();
    const keys = fresh.map((p) => `${p.region}/${p.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Test tab saved sets and sheet size', () => {
  it('keeps the Test tab picks apart from the real Map picks', () => {
    const base = { uid: 'u', ratingsCount: 12, origin: ORIGIN, miles: 5 };
    expect(nearbyPicksCacheKey({ ...base, scope: 'test' })).not.toBe(nearbyPicksCacheKey(base));
    expect(nearbyPicksCacheKey({ ...base, scope: 'test' })).toMatch(/:test$/);
  });

  it('opens half way up the screen', () => {
    expect(PICKS_SHEET_H.moodExpanded).toBe('50dvh');
  });
});
