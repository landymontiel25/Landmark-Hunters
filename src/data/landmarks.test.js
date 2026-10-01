import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_LANDMARKS, INTERESTS, REGIONS, sortInterests } from './regions';

const KNOWN = new Set(INTERESTS.map((i) => i.id));

describe('landmark catalog', () => {
  it('gives every landmark exactly one known category', () => {
    const bad = ALL_LANDMARKS.filter((l) => !Array.isArray(l.categories) || l.categories.length !== 1 || !KNOWN.has(l.categories[0]));
    expect(bad.map((l) => `${l.regionId}/${l.id}: ${JSON.stringify(l.categories)}`)).toEqual([]);
  });

  it('keeps Local Life to bars, clubs and live music', () => {
    const local = ALL_LANDMARKS.filter((l) => l.categories[0] === 'local-life').map((l) => l.id);
    expect(local.length).toBeLessThanOrEqual(12);
    expect(local).toContain('ball-and-chain');
    expect(local).not.toContain('calle-ocho');
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

describe('sortInterests', () => {
  it('orders A–Z by default, newest and oldest by when the category was added', () => {
    expect(sortInterests(INTERESTS)[0].label).toBe('10/10 Benches');
    expect(sortInterests(INTERESTS, 'newest')[0].id).toBe('tech');
    expect(sortInterests(INTERESTS, 'oldest')[0].id).toBe('history-culture');
    expect(new Set(INTERESTS.map((i) => i.added)).size).toBe(INTERESTS.length);
  });
});
