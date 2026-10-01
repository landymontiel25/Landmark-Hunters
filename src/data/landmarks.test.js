import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_LANDMARKS, INTERESTS, REGIONS, sortInterests, canonicalLandmarkId } from './regions';

const KNOWN = new Set(INTERESTS.map((i) => i.id));

describe('landmark catalog', () => {
  it('gives every landmark exactly one known category', () => {
    const bad = ALL_LANDMARKS.filter((l) => !Array.isArray(l.categories) || l.categories.length !== 1 || !KNOWN.has(l.categories[0]));
    expect(bad.map((l) => `${l.regionId}/${l.id}: ${JSON.stringify(l.categories)}`)).toEqual([]);
  });

  it('keeps Local Life to bars, clubs and live music', () => {
    const local = ALL_LANDMARKS.filter((l) => l.categories[0] === 'local-life').map((l) => l.id);
    expect(local.length).toBeLessThanOrEqual(80);
    expect(local).toContain('ball-and-chain');
    expect(local).not.toContain('calle-ocho');
  });

  // A hotel is not a restaurant: the Test tab's "Something to eat" mood is
  // every Food landmark, so a lodging filed under Food shows up as dinner.
  // These are real restaurants (a hotel's restaurant, a roadside burger inn).
  it('never files lodging under Food (except restaurants with a hotel/inn in the name)', () => {
    const LODGING = /\b(hotel|inn|motel|hostel|resort|lodge|suites)\b/i;
    const RESTAURANTS_IN_HOTELS = new Set(['hotel-ristorante-la-darsena', 'derby-grill-monza', 'alpine-inn-zotts-rossottis']);
    const bad = ALL_LANDMARKS.filter(
      (l) => l.categories[0] === 'food' && LODGING.test(l.name) && !RESTAURANTS_IN_HOTELS.has(l.id)
    );
    expect(bad.map((l) => `${l.regionId}/${l.id}: ${l.name}`)).toEqual([]);
    const stays = ALL_LANDMARKS.filter((l) => l.categories[0] === 'food' && /\b(modern|boutique) hotel\b|\bguest rooms\b/i.test(l.summary));
    expect(stays.map((l) => `${l.regionId}/${l.id}`)).toEqual([]);
  });

  it('files theaters, opera houses and cinemas under Entertainment (or Local Life for live-music clubs), and nightclubs under Local Life', () => {
    const VENUE = /\b(theat(er|re)|teatro|cinema|opera house|music hall|concert hall)\b/i;
    const badVenue = ALL_LANDMARKS.filter((l) => VENUE.test(l.name) && !['entertainment', 'local-life'].includes(l.categories[0]));
    expect(badVenue.map((l) => `${l.regionId}/${l.id}: ${l.categories[0]}`)).toEqual([]);
    const badClub = ALL_LANDMARKS.filter((l) => /\bnightclub\b/i.test(l.summary) && !['local-life', 'entertainment'].includes(l.categories[0]));
    expect(badClub.map((l) => `${l.regionId}/${l.id}`)).toEqual([]);
    expect(ALL_LANDMARKS.find((l) => l.id === 'le-duplex').categories).toEqual(['local-life']);
  });

  it('keeps cost and the free flag consistent for paid venues', () => {
    const PAID_KINDS = new Set(['food', 'stadiums', 'entertainment', 'formula-1']);
    const bad = ALL_LANDMARKS.filter((l) => PAID_KINDS.has(l.categories[0]) && l.free === true && /^\$/.test(l.cost || ''));
    expect(bad.map((l) => `${l.regionId}/${l.id}: ${l.cost}`)).toEqual([]);
  });

  it('never repeats a region/id pair', () => {
    const keys = ALL_LANDMARKS.map((l) => `${l.regionId}/${l.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// Per-landmark records are looked up by id alone in several places (check-ins,
// ratings, reviews, photos), so an id shared by two cities makes a visit to one
// show up as a visit to the other.
describe('landmark ids and data', () => {
  it('uses every landmark id in only one region', () => {
    const seen = new Map();
    const dupes = [];
    for (const l of ALL_LANDMARKS) {
      if (seen.has(l.id)) dupes.push(`${l.id}: ${seen.get(l.id)}, ${l.regionId}`);
      else seen.set(l.id, l.regionId);
    }
    expect(dupes).toEqual([]);
  });

  it('only lists real image URLs (https, or a file that exists in public/)', () => {
    const bad = [];
    for (const l of ALL_LANDMARKS)
      for (const src of l.images || []) {
        const ok =
          typeof src === 'string' &&
          (/^https:\/\/[^\s"\\]+$/.test(src) || (src.startsWith('/landmarks/') && existsSync(`public${src}`)));
        if (!ok) bad.push(`${l.regionId}/${l.id}: ${src}`);
      }
    expect(bad).toEqual([]);
  });

  it('has numeric coordinates, minutes, facts and a free flag for every landmark', () => {
    const bad = ALL_LANDMARKS.filter(
      (l) =>
        !Number.isFinite(l.lat) ||
        !Number.isFinite(l.lng) ||
        !(l.typicalMinutes > 0) ||
        typeof l.free !== 'boolean' ||
        !Array.isArray(l.facts) ||
        !l.name?.trim()
    );
    expect(bad.map((l) => `${l.regionId}/${l.id}`)).toEqual([]);
  });

  it('keeps each landmark near its own city (catches mis-geocoded pins)', () => {
    // Real exceptions: an airport and a NASA station that sit well outside
    // their city's search box.
    const allowed = new Set(['milan-malpensa-airport', 'nasa-robledo-de-chavela']);
    const MARGIN = 0.1; // degrees, roughly 11 km
    const bad = [];
    for (const r of REGIONS) {
      if (r.worldwide) continue;
      const v = r.viewbox;
      for (const l of r.landmarks) {
        if (allowed.has(l.id)) continue;
        if (l.lat < v.minLat - MARGIN || l.lat > v.maxLat + MARGIN || l.lng < v.minLng - MARGIN || l.lng > v.maxLng + MARGIN)
          bad.push(`${r.id}/${l.id} (${l.lat}, ${l.lng})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('catalog text and image hygiene', () => {
  const textOf = (l) => [l.name, l.summary, l.tip, l.neighborhood, l.cost, ...(l.facts || [])].filter((s) => typeof s === 'string');

  it('has no escape/entity artifacts or placeholder text in user-visible strings', () => {
    const ARTIFACT = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);|[a-z]x(?:27|22|26)[a-z]|\\u[0-9a-f]{4}|\\[nt"']|%[0-9A-F]{2}|\*\*|`|\bundefined\b|\bnull\b|\bNaN\b|\bTODO\b|lorem ipsum|[\u0000-\u001f ​�]/i;
    const bad = [];
    for (const l of ALL_LANDMARKS)
      for (const s of textOf(l)) {
        if (ARTIFACT.test(s) || / {2,}/.test(s) || s !== s.trim() || !s.length) bad.push(`${l.regionId}/${l.id}: ${s.slice(0, 80)}`);
      }
    expect(bad).toEqual([]);
  });

  it('has balanced curly quotes and parentheses', () => {
    const count = (s, re) => (s.match(re) || []).length;
    const bad = [];
    for (const l of ALL_LANDMARKS)
      for (const s of textOf(l))
        if (count(s, /“/g) !== count(s, /”/g) || count(s, /\(/g) !== count(s, /\)/g)) bad.push(`${l.regionId}/${l.id}: ${s.slice(0, 80)}`);
    expect(bad).toEqual([]);
  });

  it('gives every landmark a name and a summary of real sentences', () => {
    const bad = ALL_LANDMARKS.filter((l) => !l.summary || l.summary.trim().length < 20 || !/[.!?)"”']$/.test(l.summary.trim()));
    expect(bad.map((l) => `${l.regionId}/${l.id}`)).toEqual([]);
  });

  it('uses only valid, in-range coordinates (no zeros, no flipped signs for the Americas)', () => {
    const WEST = new Set(['miami', 'key-biscayne', 'coral-gables', 'san-francisco', 'silicon-valley', 'nyc', 'philly', 'villanova']);
    const bad = ALL_LANDMARKS.filter(
      (l) => l.lat === 0 || l.lng === 0 || Math.abs(l.lat) > 90 || Math.abs(l.lng) > 180 || (WEST.has(l.regionId) && (l.lng >= 0 || l.lat <= 0))
    );
    expect(bad.map((l) => `${l.regionId}/${l.id}`)).toEqual([]);
  });

  it('keeps every region well formed (unique id, center inside its own map bounds)', () => {
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
    const bad = REGIONS.filter((r) => {
      const v = r.viewbox;
      const c = r.center;
      return !r.name || !(v.minLat < v.maxLat && v.minLng < v.maxLng) || (c && (c.lat < v.minLat || c.lat > v.maxLat || c.lng < v.minLng || c.lng > v.maxLng));
    });
    expect(bad.map((r) => r.id)).toEqual([]);
  });

  it('only lists https image URLs on known hosts, with no repeats inside one landmark', () => {
    const HOSTS = new Set(['commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org', 'www.miamibeachfl.gov']);
    const bad = [];
    for (const l of ALL_LANDMARKS) {
      const imgs = l.images || [];
      if (new Set(imgs).size !== imgs.length) bad.push(`${l.regionId}/${l.id}: repeated image`);
      for (const src of imgs) if (src.startsWith('https://') && !HOSTS.has(new URL(src).host)) bad.push(`${l.regionId}/${l.id}: ${src}`);
    }
    expect(bad).toEqual([]);
  });

  it('never reuses one photo across different cities (a photo of Rome on a Philly arboretum)', () => {
    const owner = new Map();
    const bad = [];
    for (const l of ALL_LANDMARKS)
      for (const src of l.images || []) {
        const prev = owner.get(src);
        if (prev && prev !== l.regionId) bad.push(`${prev} & ${l.regionId}/${l.id}: ${src.slice(0, 90)}`);
        else owner.set(src, l.regionId);
      }
    expect(bad).toEqual([]);
  });
});

describe('canonicalLandmarkId (renamed San Francisco ids)', () => {
  it('maps pre-rename San Francisco records to the new ids and leaves everything else alone', () => {
    expect(canonicalLandmarkId('washington-square-park', 'san-francisco')).toBe('washington-square-park-sf');
    expect(canonicalLandmarkId('the-battery', 'san-francisco')).toBe('the-battery-sf');
    expect(canonicalLandmarkId('the-battery', 'nyc')).toBe('the-battery');
    expect(canonicalLandmarkId('ferry-building', 'san-francisco')).toBe('ferry-building');
    const sfIds = new Set(ALL_LANDMARKS.filter((l) => l.regionId === 'san-francisco').map((l) => l.id));
    expect(sfIds.has(canonicalLandmarkId('the-battery', 'san-francisco'))).toBe(true);
  });
});

describe('sortInterests', () => {
  it('orders A–Z by default, newest and oldest by when the category was added', () => {
    expect(sortInterests(INTERESTS)[0].label).toBe('10/10 Benches');
    expect(sortInterests(INTERESTS, 'newest')[0].id).toBe('tech');
    expect(sortInterests(INTERESTS, 'oldest')[0].id).toBe('history-culture');
    expect(new Set(INTERESTS.map((i) => i.added)).size).toBe(INTERESTS.length);
  });
});
