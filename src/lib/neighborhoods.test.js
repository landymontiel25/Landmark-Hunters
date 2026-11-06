import { describe, it, expect } from 'vitest';
import DATA from '../data/miamiNeighborhoods.json';
import {
  DASH,
  chipsFor,
  exploreSummary,
  formatScore,
  overallScore,
  scoreBand,
  visibleNeighborhoods,
} from './neighborhoods';

const ratings = (o = {}) => ({
  safety: null,
  walkability: null,
  restaurants: { quantity: null, price: null, diversity: null },
  nightlife: null,
  averagePropertyPrice: null,
  artAndCulture: null,
  shopping: null,
  ...o,
});

describe('the data file', () => {
  it('lists every neighborhood once, with empty info and tags, and ratings null or 0-5', () => {
    const names = DATA.neighborhoods.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['Brickell', 'Midtown', 'South Beach', 'North Beach', 'Coral Gables', 'Sweetwater']) expect(names).toContain(name);
    for (const n of DATA.neighborhoods) {
      expect(n.info).toBe('');
      expect(n.tags).toEqual([]);
      const values = [n.ratings.safety, n.ratings.walkability, n.ratings.nightlife, n.ratings.averagePropertyPrice, n.ratings.artAndCulture, n.ratings.shopping, n.ratings.restaurants.quantity, n.ratings.restaurants.diversity];
      for (const v of values) expect(v === null || (v >= 0 && v <= 5)).toBe(true);
      expect(n.ratings.restaurants.price).toBeNull();
    }
  });

  it('keeps the owner\'s city order', () => {
    const cities = [...new Set(DATA.neighborhoods.map((n) => n.cityGroup))];
    expect(cities.slice(0, 3)).toEqual(['City of Miami', 'Miami Beach', 'Other Miami-Dade cities']);
    expect(DATA.neighborhoods[0].name).toBe('Brickell');
  });

  it('every photo is a Wikimedia Commons file with a credit, or empty', () => {
    for (const n of DATA.neighborhoods) {
      if (!n.photo) continue;
      expect(n.photo).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
      expect(n.photoCredit.license).toBeTruthy();
      expect(n.photoCredit.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('every tier name is a neighborhood in the file', () => {
    const names = new Set(DATA.neighborhoods.map((n) => n.name));
    for (const t of DATA.tiers) {
      expect(t.neighborhoods).toHaveLength(10);
      for (const name of t.neighborhoods) expect(names.has(name)).toBe(true);
    }
  });
});

describe('overall score', () => {
  it('averages the seven ratings, Restaurants as its Quantity/Diversity average', () => {
    // 2, 4, (3), 5, 1, 3, 4 -> 22 / 7 = 3.14 -> 3.1
    const r = ratings({ safety: 2, walkability: 4, restaurants: { quantity: 2, price: 5, diversity: 4 }, nightlife: 5, averagePropertyPrice: 1, artAndCulture: 3, shopping: 4 });
    expect(overallScore(r)).toBe(3.1);
  });

  it('leaves Price out of Restaurants', () => {
    const r = ratings({ restaurants: { quantity: 2, price: 0, diversity: 4 } });
    expect(overallScore(r)).toBe(3);
  });

  it('skips nulls', () => {
    expect(overallScore(ratings({ safety: 4, nightlife: 2 }))).toBe(3);
    expect(overallScore(ratings({ restaurants: { quantity: 5, price: null, diversity: null } }))).toBe(5);
  });

  it('is null when every rating is null', () => {
    expect(overallScore(ratings())).toBeNull();
    expect(formatScore(null)).toBe(DASH);
  });
});

describe('score colors', () => {
  it('1.0 red, 3.0 yellow, 4.5 green, and the band edges', () => {
    expect(scoreBand(1.0)).toBe('red');
    expect(scoreBand(3.0)).toBe('yellow');
    expect(scoreBand(4.5)).toBe('green');
    expect(scoreBand(1.99)).toBe('red');
    expect(scoreBand(2)).toBe('yellow');
    expect(scoreBand(4)).toBe('green');
    expect(scoreBand(null)).toBe('none');
  });
});

describe('lists', () => {
  it('Popular shows exactly the four featured, in order', () => {
    const { items } = visibleNeighborhoods(DATA, { tab: 'popular' });
    expect(items.map((n) => n.name)).toEqual(['South Beach', 'Wynwood', 'Downtown Miami', 'Little Havana']);
  });

  it('All areas groups by city and keeps the file order', () => {
    const { items, groups } = visibleNeighborhoods(DATA, { tab: 'all', chipId: null });
    expect(items.map((n) => n.name)).toEqual(DATA.neighborhoods.map((n) => n.name));
    expect(groups.map((g) => g.city)).toEqual([...new Set(DATA.neighborhoods.map((n) => n.cityGroup))]);
    expect(groups.flatMap((g) => g.items)).toEqual(DATA.neighborhoods);
  });

  it('Nearby needs a location, then lists closest first', () => {
    expect(visibleNeighborhoods(DATA, { tab: 'nearby', chipId: null }).needsLocation).toBe(true);
    const wynwoodWalls = { lat: 25.8011, lng: -80.1993 };
    const { items, needsLocation } = visibleNeighborhoods(DATA, { tab: 'nearby', chipId: null, coords: wynwoodWalls });
    expect(needsLocation).toBe(false);
    expect(items[0].name).toBe('Wynwood');
    expect(items).toHaveLength(DATA.neighborhoods.length);
  });

  it('search filters by name, ignoring case', () => {
    const { items } = visibleNeighborhoods(DATA, { tab: 'all', chipId: null, search: 'BEACH' });
    expect(items.length).toBeGreaterThan(3);
    for (const n of items) expect(n.name.toLowerCase()).toContain('beach');
    expect(visibleNeighborhoods(DATA, { tab: 'all', chipId: null, search: 'zzz' }).items).toEqual([]);
  });
});

describe('chips', () => {
  const data = {
    city: 'Miami',
    featured: ['A', 'B'],
    tiers: [{ id: 'tier1', label: 'Tier 1', title: 'Very high tourist traffic', neighborhoods: ['C', 'A'] }],
    neighborhoods: [
      { name: 'A', cityGroup: 'X', tags: ['Beaches'], ratings: ratings() },
      { name: 'B', cityGroup: 'X', tags: ['Art & Culture', 'Family'], ratings: ratings() },
      { name: 'C', cityGroup: 'Y', tags: ['beaches'], ratings: ratings() },
    ],
  };

  it('come in the owner\'s order, Must-See first, then the tiers', () => {
    expect(chipsFor(data).map((c) => c.label)).toEqual(['Must-See', 'Art & Culture', 'Food & Drinks', 'Beaches', 'Family', 'Hidden Gems', 'Tier 1']);
  });

  it.each([
    ['must-see', ['A', 'B']],
    ['art', ['B']],
    ['food', []],
    ['beaches', ['A', 'C']],
    ['family', ['B']],
    ['hidden', []],
    ['tier1', ['A', 'C']],
  ])('%s filters to the right neighborhoods, and the Explore line counts them', (chipId, expected) => {
    const { items } = visibleNeighborhoods(data, { tab: 'all', chipId });
    expect(items.map((n) => n.name)).toEqual(expected);
    if (expected.length) expect(exploreSummary(items)).toBe(`${expected.length} ${expected.length === 1 ? 'neighborhood' : 'neighborhoods'} · ${expected.join(', ')}`);
  });

  it('work with the top tabs: Popular keeps only featured ones that match', () => {
    expect(visibleNeighborhoods(data, { tab: 'popular', chipId: 'beaches' }).items.map((n) => n.name)).toEqual(['A']);
  });

  it('the Explore line reads like the mockup', () => {
    const { items } = visibleNeighborhoods(DATA, { tab: 'popular' });
    expect(exploreSummary(items)).toBe('4 neighborhoods · South Beach, Wynwood, Downtown Miami, Little Havana');
  });
});
