import { describe, it, expect } from 'vitest';
import { MOODS, TEST_DEFAULT_DISTANCE_MI, TEST_MOODS, moodPlaces } from './nearbyPicks';
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';

const place = (id, categories, miles) => ({ id, regionId: 'test', name: id, categories, distanceMeters: miles * 1609.34 });

describe('the Test tab moods', () => {
  it('lists the Map moods without tech spots', () => {
    expect(TEST_MOODS.map((m) => m.id)).toEqual(['eat', 'history', 'outdoors', 'night', 'shopping', 'dayout', 'sports']);
    expect(TEST_MOODS.some((m) => m.id === 'tech' || /tech/i.test(m.label))).toBe(false);
  });

  it('makes a night out Nightlife, which now includes shows and zoos', () => {
    const night = TEST_MOODS.find((m) => m.id === 'night');
    expect(night.categories).toEqual(['local-life']);
    const pool = [place('bar', ['local-life'], 0.4), place('zoo', ['local-life'], 0.2), place('cafe', ['food'], 0.1)];
    expect(moodPlaces({ moodId: 'night', pool, moods: TEST_MOODS }).map((p) => p.id)).toEqual(['zoo', 'bar']);
    expect(INTERESTS.some((i) => i.id === 'entertainment')).toBe(false);
  });

  it('does not change the real Map moods', () => {
    expect(MOODS[0].id).toBe('eat');
    expect(MOODS.some((m) => m.id === 'tech')).toBe(true);
  });

  it('starts the Test tab picks at 5 miles', () => {
    expect(TEST_DEFAULT_DISTANCE_MI).toBe(5);
  });
});

describe('the Test tab moods against the real catalog', () => {
  it('only asks for categories the app knows', () => {
    const known = new Set(INTERESTS.map((i) => i.id));
    for (const m of [...TEST_MOODS, ...MOODS]) for (const c of m.categories) expect(known.has(c), `${m.id}: ${c}`).toBe(true);
  });

  it('never offers a hotel as something to eat', () => {
    const pool = ALL_LANDMARKS.map((l) => ({ ...l, distanceMeters: 1 }));
    const eat = moodPlaces({ moodId: 'eat', pool, moods: TEST_MOODS, limit: 10000 });
    expect(eat.length).toBeGreaterThan(50);
    const restaurants = new Set(['hotel-ristorante-la-darsena', 'derby-grill-monza', 'alpine-inn-zotts-rossottis']);
    expect(eat.filter((p) => /hilton|hyatt|\bhotel\b|\binn\b/i.test(p.name) && !restaurants.has(p.id)).map((p) => p.name)).toEqual([]);
  });
});
