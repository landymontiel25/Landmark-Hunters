import { describe, it, expect } from 'vitest';
import { MOODS, TEST_DEFAULT_DISTANCE_MI, TEST_MOODS, moodPlaces } from './nearbyPicks';
import { INTERESTS } from '../data/regions';

const place = (id, categories, miles) => ({ id, regionId: 'test', name: id, categories, distanceMeters: miles * 1609.34 });

describe('the Test tab moods', () => {
  it('lists eating, then entertainment, then the rest, and no tech spots', () => {
    expect(TEST_MOODS.map((m) => m.id)).toEqual(['eat', 'entertainment', 'history', 'art', 'outdoors', 'night', 'sports']);
    expect(TEST_MOODS.some((m) => m.id === 'tech' || /tech/i.test(m.label))).toBe(false);
  });

  it('uses the real Entertainment category', () => {
    const entertainment = TEST_MOODS.find((m) => m.id === 'entertainment');
    expect(entertainment.label).toBe('Entertainment');
    expect(entertainment.categories).toEqual(['entertainment']);
    expect(INTERESTS.some((i) => i.id === 'entertainment')).toBe(true);
  });

  it('finds only entertainment places for the Entertainment mood, closest first', () => {
    const pool = [place('zoo', ['entertainment'], 3), place('cafe', ['food'], 0.2), place('show', ['entertainment'], 1), place('bar', ['local-life'], 0.5)];
    const found = moodPlaces({ moodId: 'entertainment', pool, moods: TEST_MOODS });
    expect(found.map((p) => p.id)).toEqual(['show', 'zoo']);
  });

  it('does not change the real Map moods', () => {
    expect(MOODS[0].id).toBe('eat');
    expect(MOODS.some((m) => m.id === 'tech')).toBe(true);
    expect(moodPlaces({ moodId: 'entertainment', pool: [place('zoo', ['entertainment'], 1)] })).toEqual([]);
  });

  it('starts the Test tab picks at 5 miles', () => {
    expect(TEST_DEFAULT_DISTANCE_MI).toBe(5);
  });
});
