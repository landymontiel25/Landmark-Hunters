import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import data from './miamiNeighborhoods.json';

// Tags on the Neighborhoods subtab's chips (owner, 2026-11-09): only these
// five strings, and every tag needs a source URL in
// scripts/neighborhoods/tag-sources.json that someone can check.
const ALLOWED = ['Art & Culture', 'Food & Drinks', 'Beaches', 'Family', 'Hidden Gems'];
const sources = JSON.parse(readFileSync(new URL('../../scripts/neighborhoods/tag-sources.json', import.meta.url), 'utf8'));
const tier1 = new Set(data.tiers.find((t) => t.id === 'tier1').neighborhoods);

describe('neighborhood tags', () => {
  it('only uses the five allowed tags, each at most once', () => {
    for (const n of data.neighborhoods) {
      for (const tag of n.tags || []) expect(ALLOWED, `${n.name}: ${tag}`).toContain(tag);
      expect(new Set(n.tags).size, n.name).toBe((n.tags || []).length);
    }
  });

  it('gives every tag at least one http(s) URL in tag-sources.json', () => {
    for (const n of data.neighborhoods) {
      for (const tag of n.tags || []) {
        const urls = sources[n.name]?.[tag];
        expect(Array.isArray(urls) && urls.length > 0, `${n.name} / ${tag} has no source`).toBe(true);
        for (const u of urls) expect(u, `${n.name} / ${tag}`).toMatch(/^https?:\/\/\S+$/);
      }
    }
  });

  it('lists no source for a tag the neighborhood does not have, or for an unknown neighborhood', () => {
    const names = new Map(data.neighborhoods.map((n) => [n.name, n]));
    for (const [name, byTag] of Object.entries(sources)) {
      expect(names.has(name), `unknown neighborhood ${name}`).toBe(true);
      for (const tag of Object.keys(byTag)) expect(names.get(name).tags, `${name} / ${tag}`).toContain(tag);
    }
  });

  it('never gives Hidden Gems to a Tier 1 neighborhood', () => {
    for (const n of data.neighborhoods) {
      if (tier1.has(n.name)) expect(n.tags, n.name).not.toContain('Hidden Gems');
    }
  });
});
