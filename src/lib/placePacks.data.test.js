// The shipped place chunks (public/places, listed in the manifest): every
// place has the catalog landmark shape, a real Mapr category, a unique id,
// coordinates inside its region, credited photos only, and works with
// check-in, the rating question and tag scoring.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLACE_PACKS } from '../data/placePacks.manifest.js';
import { ALL_LANDMARKS, INTERESTS, getRegion, registerPlaces, getLandmark } from '../data/regions.js';
import { insideShape } from '../../scripts/osm-import/transform.js';
import { IMPORT_REGIONS } from '../../scripts/osm-import/regions.js';
import { isNearEnough } from './checkinRules.js';
import { tierQuestion } from './ratingFlow.js';
import { applyRating } from './tagScores.js';

const CATEGORY_IDS = new Set(INTERESTS.map((i) => i.id));
const catalogIds = new Set(ALL_LANDMARKS.map((l) => `${l.regionId}/${l.id}`));
const packs = PLACE_PACKS.map((p) => ({ ...p, places: JSON.parse(fs.readFileSync(path.join('public', p.file), 'utf8')) }));
const all = packs.flatMap((p) => p.places);

describe.runIf(packs.length)('shipped place chunks', () => {
  it('match their manifest entries', () => {
    for (const p of packs) {
      expect(p.places.length).toBe(p.count);
      for (const l of p.places) expect(l.categories[0]).toBe(p.category);
    }
  });

  it('have unique ids that never collide with the catalog', () => {
    const ids = all.map((l) => `${l.region}/${l.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(catalogIds.has(id)).toBe(false);
  });

  it('have the catalog landmark shape', () => {
    for (const l of all) {
      // An OSM object's id, or a researched place located at its address
      // (locate-candidates.mjs addressFallback): osm-<import region>-<name>.
      expect(l.id).toMatch(/^osm-([nwr]\d+|kb-[a-z0-9-]+)$/);
      expect(typeof l.name).toBe('string');
      expect(l.name.trim()).toBe(l.name);
      expect(l.name.length).toBeGreaterThan(0);
      expect(getRegion(l.region)).toBeTruthy();
      expect(Number.isFinite(l.lat) && Number.isFinite(l.lng)).toBe(true);
      expect(l.categories).toHaveLength(1);
      expect(CATEGORY_IDS.has(l.categories[0])).toBe(true);
      expect(typeof l.summary).toBe('string');
      expect(Array.isArray(l.facts)).toBe(true);
      expect(Array.isArray(l.images)).toBe(true);
      expect([true, false, null]).toContain(l.free);
      expect(l.bookingUrl).toBeNull();
      expect(l.typicalMinutes).toBeGreaterThan(0);
      expect(l.source).toBe('osm');
      expect(l.osmUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);
    }
  });

  it('sit inside their import region\'s shape, in the app region it assigns', () => {
    for (const p of packs) {
      // The first import region filling this app region, plus any research
      // region merged into it (regions.js mergeFrom, e.g. Key Biscayne).
      const [id, region] = Object.entries(IMPORT_REGIONS).find(([, r]) => r.packRegions.includes(p.region)) || [];
      expect(region, `no import region fills ${p.region}`).toBeTruthy();
      const shapes = [region, ...(region.mergeFrom || []).map((m) => IMPORT_REGIONS[m])];
      for (const l of p.places) {
        expect(l.region).toBe(p.region);
        const from = shapes.find((r) => insideShape(l.lat, l.lng, r.shape));
        expect(from, `${l.name} (${id})`).toBeTruthy();
        expect(from.packRegionOf(l.lat, l.lng)).toBe(l.region);
      }
    }
  });

  it('carry a Commons credit for every stored photo and nothing from Google', () => {
    for (const l of all) {
      for (const src of l.images) {
        expect(src).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//);
        const c = l.imageCredits?.[src];
        expect(c?.license).toBeTruthy();
        expect(c?.pageUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      }
      // Google Places refs look like places/<id>; a researched fact's source
      // page (factSources) or the place's own website may have /places/ in
      // its path.
      const { factSources, website, ...rest } = l;
      expect(JSON.stringify(rest)).not.toMatch(/googleapis|googleusercontent|places\//);
      expect(JSON.stringify({ factSources, website })).not.toMatch(/googleapis|googleusercontent/);
      // A researched fact names the page it came from.
      for (const [fact, url] of Object.entries(l.factSources || {})) {
        expect(l.facts).toContain(fact);
        expect(url).toMatch(/^https:\/\//);
      }
    }
  });

  it('work with lookup, check-in, rating and Mapr scoring', () => {
    registerPlaces(all);
    const byCat = new Map();
    for (const l of all) if (!byCat.has(l.categories[0])) byCat.set(l.categories[0], l);
    for (const l of byCat.values()) {
      expect(getLandmark(l.region, l.id)).toBe(l);
      expect(isNearEnough({ lat: l.lat, lng: l.lng, accuracy: 10 }, l)).toBe(true);
      expect(tierQuestion(l)).toMatch(/^Do you like /);
      expect(applyRating({}, l.categories, 'highly-recommend', Date.now()).scores[l.categories[0]]).toBeGreaterThan(0);
    }
  });
});
