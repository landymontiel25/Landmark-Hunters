// Every mall in the app comes with the stores inside it. A mall is a catalog
// place the import mapped as one (topic 'mall') or one marked `mall: true`;
// adding a mall without its store list (scripts/build-mall-stores.mjs) fails
// here, so no mall ships empty.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLACE_PACKS } from './placePacks.manifest.js';
import { ALL_LANDMARKS } from './regions.js';
import { MALL_STORES } from './mallStores.js';
import { isMallPlace, storesOfPlace } from '../lib/malls.js';

const packed = PLACE_PACKS.flatMap((p) => JSON.parse(fs.readFileSync(path.join('public', p.file), 'utf8')).map((l) => ({ ...l, regionId: l.region })));
const malls = [...ALL_LANDMARKS, ...packed].filter(isMallPlace);
const TAGS = new Set(['clothing', 'shoes', 'department store', 'beauty', 'electronics', 'books', 'home', 'sports', 'toys', 'jewelry', 'coffee', 'cafe', 'food', 'fast food', 'dessert', 'entertainment', 'fitness', 'pets', 'gifts', 'luxury', 'grocery', 'pharmacy']);

describe('mall stores', () => {
  it('has a store list for every mall in the app', () => {
    const missing = malls.filter((l) => storesOfPlace(l.regionId, l.id).length === 0).map((l) => `${l.regionId}/${l.id} ${l.name}`);
    expect(missing).toEqual([]);
  });

  it('only lists malls that are in the app, each store tagged and sourced', () => {
    const keys = new Set(malls.map((l) => `${l.regionId}/${l.id}`));
    for (const m of MALL_STORES) {
      expect(keys.has(m.key), m.key).toBe(true);
      expect(m.source).toMatch(/^https?:\/\//);
      for (const s of m.stores) {
        expect(s.tags.length).toBeGreaterThan(0);
        for (const t of s.tags) expect(TAGS.has(t), `${s.name}: ${t}`).toBe(true);
      }
    }
  });
});
