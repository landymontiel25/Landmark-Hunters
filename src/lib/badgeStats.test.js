import { describe, it, expect } from 'vitest';
import {
  countPhotoCheckins,
  maxRegionCheckins,
  countDistinctStates,
  countDistinctCountries,
  hasNightOwlCheckin,
  hasGoldenHourCheckin,
  countCuisineTypes,
  hasAllStarWeek,
} from './badgeStats';

const sec = (isoDate) => Math.floor(new Date(isoDate).getTime() / 1000);
const at = (isoDate) => ({ createdAt: { seconds: sec(isoDate) } });

describe('countPhotoCheckins', () => {
  it('counts check-ins with either a single photoURL or a photoURLs array', () => {
    const checkins = [{ photoURL: 'a.jpg' }, { photoURLs: ['b.jpg', 'c.jpg'] }, { photoURLs: [] }, {}];
    expect(countPhotoCheckins(checkins)).toBe(2);
  });
});

describe('maxRegionCheckins', () => {
  it('returns the largest distinct-landmark count in any single region', () => {
    const checkins = [
      { region: 'miami', landmarkId: 'a' },
      { region: 'miami', landmarkId: 'b' },
      { region: 'miami', landmarkId: 'a' }, // duplicate landmark, not double-counted
      { region: 'nyc', landmarkId: 'x' },
    ];
    expect(maxRegionCheckins(checkins)).toBe(2);
  });

  it('is 0 with no check-ins', () => {
    expect(maxRegionCheckins([])).toBe(0);
  });
});

describe('countDistinctStates / countDistinctCountries', () => {
  const checkins = [
    { state: 'Florida', country: 'USA' },
    { state: 'Pennsylvania', country: 'USA' },
    { state: null, country: 'Spain' },
    { state: 'Florida', country: 'USA' }, // duplicate
  ];
  it('counts distinct non-null states', () => {
    expect(countDistinctStates(checkins)).toBe(2);
  });
  it('counts distinct countries', () => {
    expect(countDistinctCountries(checkins)).toBe(2);
  });
});

describe('hasNightOwlCheckin / hasGoldenHourCheckin', () => {
  it('detects a check-in in the local midnight-6am window', () => {
    const d = new Date();
    d.setHours(3, 0, 0, 0);
    expect(hasNightOwlCheckin([{ createdAt: { seconds: Math.floor(d.getTime() / 1000) } }])).toBe(true);
  });

  it('detects a check-in in the local 6-7pm window', () => {
    const d = new Date();
    d.setHours(18, 30, 0, 0);
    expect(hasGoldenHourCheckin([{ createdAt: { seconds: Math.floor(d.getTime() / 1000) } }])).toBe(true);
  });

  it('is false for a check-in outside either window', () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    const c = [{ createdAt: { seconds: Math.floor(d.getTime() / 1000) } }];
    expect(hasNightOwlCheckin(c)).toBe(false);
    expect(hasGoldenHourCheckin(c)).toBe(false);
  });
});

describe('countCuisineTypes', () => {
  it('counts distinct landmarks tagged food', () => {
    const checkins = [
      { landmarkId: 'a', categories: ['food'] },
      { landmarkId: 'b', categories: ['food', 'local-life'] },
      { landmarkId: 'a', categories: ['food'] }, // duplicate landmark
      { landmarkId: 'c', categories: ['parks-nature'] },
    ];
    expect(countCuisineTypes(checkins)).toBe(2);
  });
});

describe('hasAllStarWeek', () => {
  it('is true when all 3 categories are hit within 7 days', () => {
    const checkins = [
      { ...at('2026-03-03T10:00:00Z'), categories: ['food'] },
      { ...at('2026-03-05T10:00:00Z'), categories: ['history-culture'] },
      { ...at('2026-03-07T10:00:00Z'), categories: ['parks-nature'] },
    ];
    expect(hasAllStarWeek(checkins)).toBe(true);
  });

  it('is false when the 3 categories are spread across more than 7 days', () => {
    const checkins = [
      { ...at('2026-03-01T10:00:00Z'), categories: ['food'] },
      { ...at('2026-03-07T10:00:00Z'), categories: ['history-culture'] },
      { ...at('2026-03-10T10:00:00Z'), categories: ['parks-nature'] },
    ];
    expect(hasAllStarWeek(checkins)).toBe(false);
  });

  it('is false when only some categories are ever hit', () => {
    const checkins = [
      { ...at('2026-03-01T10:00:00Z'), categories: ['art-museums'] },
      { ...at('2026-03-02T10:00:00Z'), categories: ['food'] },
    ];
    expect(hasAllStarWeek(checkins)).toBe(false);
  });
});
