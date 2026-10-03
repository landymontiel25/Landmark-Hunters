import { describe, it, expect } from 'vitest';
import { selectPlaces, tierOf, isPocketPark, richness } from './select.js';
import { importRegion, inVillanovaBox, PHILLY_SHAPE } from './regions.js';
import { insideShape } from './transform.js';

const place = (id, name, category, topic, extra = {}) => ({ id, name, categories: [category], topic, facts: [], lat: 39.95, lng: -75.16, ...extra });
const VILLANOVA = [40.0375, -75.3425];
const opts = { anchors: [VILLANOVA], anchorMeters: 3000 };

describe('selection tiers', () => {
  it('ranks hand-added, nightlife, Wikidata and culture places above the rest', () => {
    expect(tierOf(place('osm-n1', 'Ten Stone', 'local-life', 'pub'), {}, opts)).toBe('nightlife');
    expect(tierOf(place('osm-n2', 'Ritz Five', 'entertainment', 'movie theater'), {}, opts)).toBe('culture');
    expect(tierOf(place('osm-n3', 'Joseph Fox Bookshop', 'local-life', 'bookstore'), {}, opts)).toBe('culture');
    expect(tierOf(place('osm-n4', 'Rodin Museum', 'art-museums', 'museum', { wikidata: 'Q1' }), {}, opts)).toBe('wikidata');
    expect(tierOf(place('osm-n5', 'Up-Ryes Bagel', 'food', 'bagel shop'), {}, { ...opts, overrides: { 'osm-n5': { include: {} } } })).toBe('insider');
  });

  it('keeps everything near an anchor, and only food and parks as fill elsewhere', () => {
    expect(tierOf(place('osm-n6', 'Some Field', 'sports', 'soccer field', { lat: 40.03, lng: -75.34 }), {}, opts)).toBe('nearby');
    expect(tierOf(place('osm-n7', 'Some Field', 'sports', 'soccer field'), {}, opts)).toBe(null);
    expect(tierOf(place('osm-n8', 'Dizengoff', 'food', 'restaurant'), {}, opts)).toBe('fill');
  });

  it('skips community gardens, pocket parks, practice fields, plain old buildings and chain branches', () => {
    expect(isPocketPark(place('osm-n9', 'Bodine St. Community Garden', 'parks-nature', 'garden'))).toBe(true);
    expect(isPocketPark(place('osm-n10', 'East Parkside Tot Lot', 'parks-nature', 'park'))).toBe(true);
    expect(isPocketPark(place('osm-n11', 'Cecil Street Gardens', 'parks-nature', 'garden'), { 'garden:type': 'community' })).toBe(true);
    expect(isPocketPark(place('osm-n12', 'Wissahickon Valley Park', 'parks-nature', 'park'))).toBe(false);
    expect(tierOf(place('osm-n13', 'Proving Grounds Field 2', 'sports', 'soccer field', { lat: 40.03, lng: -75.34 }), {}, opts)).toBe(null);
    expect(tierOf(place('osm-n14', 'Overbrook Elementary School', 'history-culture', 'historic site'), { historic: 'building' }, opts)).toBe(null);
    expect(tierOf(place('osm-n15', 'Old Bank', 'history-culture', 'historic site'), { historic: 'building', 'ref:nrhp': '1' }, opts)).toBe('culture');
    expect(tierOf(place('osm-n16', 'Starbucks', 'food', 'café', { lat: 40.03, lng: -75.34 }), { brand: 'Starbucks' }, opts)).toBe(null);
    // A Wikidata item outranks every skip rule.
    expect(tierOf(place('osm-n17', 'Famous Triangle Park', 'parks-nature', 'park', { wikidata: 'Q2' }), {}, opts)).toBe('wikidata');
  });

  it('fills to the target with the richest records, never with bare ones', () => {
    const tagsById = new Map([
      ['osm-n20', { website: 'https://a', opening_hours: 'Mo-Su 08:00-17:00', cuisine: 'thai' }],
      ['osm-n21', { website: 'https://b' }],
      ['osm-n22', {}],
    ]);
    const places = [
      place('osm-n1', 'Ten Stone', 'local-life', 'pub'),
      place('osm-n20', 'Rich', 'food', 'restaurant'),
      place('osm-n21', 'Middling', 'food', 'restaurant'),
      place('osm-n22', 'Bare', 'food', 'restaurant'),
    ];
    expect(richness(places[1], tagsById.get('osm-n20'))).toBeGreaterThan(richness(places[2], tagsById.get('osm-n21')));
    const two = selectPlaces(places, { tagsById, target: 2 });
    expect(two.selected.map((p) => p.id)).toEqual(['osm-n1', 'osm-n20']);
    expect(two.tiers).toMatchObject({ nightlife: 1, fill: 1 });
    const all = selectPlaces(places, { tagsById, target: 10 });
    expect(all.selected.map((p) => p.id)).toEqual(['osm-n1', 'osm-n20', 'osm-n21']);
    expect(all.notSelected.map((p) => [p.id, p.why])).toEqual([['osm-n22', 'below the fill line (fewer OSM details)']]);
  });

  it('keeps the priority tiers even past the target', () => {
    const bars = Array.from({ length: 5 }, (_, i) => place(`osm-n${i + 1}`, `Bar ${i}`, 'local-life', 'bar'));
    expect(selectPlaces(bars, { target: 3 }).selected).toHaveLength(5);
  });
});

describe('import regions', () => {
  it('splits the Philadelphia import into the philly and villanova app regions', () => {
    const philly = importRegion('philly');
    expect(philly.packRegions).toEqual(['philly', 'villanova']);
    expect(philly.packRegionOf(...VILLANOVA)).toBe('villanova');
    expect(philly.packRegionOf(39.9526, -75.1652)).toBe('philly'); // City Hall
    expect(inVillanovaBox(40.0246, -75.3243)).toBe(false); // Kelly's Taproom, Bryn Mawr
    expect(philly.dataDir).toBe('scripts/osm-import/data/philly');
    expect(philly.docsDir).toBe('docs/philly-import');
  });

  it('covers the Main Line and Philadelphia core, not the outer suburbs', () => {
    for (const [lat, lng] of [
      VILLANOVA,
      [40.044, -75.3877], // Wayne
      [40.0793, -75.3016], // Conshohocken
      [40.0262, -75.2241], // Manayunk
      [39.9526, -75.1652], // City Hall
      [39.9725, -75.1339], // Fishtown
      [39.9061, -75.1665], // Lincoln Financial Field
    ])
      expect(insideShape(lat, lng, PHILLY_SHAPE)).toBe(true);
    expect(insideShape(40.1013, -75.3836, PHILLY_SHAPE)).toBe(false); // King of Prussia
    expect(insideShape(40.0, -75.0, PHILLY_SHAPE)).toBe(false); // New Jersey
  });

  it('keeps Miami as it was', () => {
    const miami = importRegion('miami');
    expect(miami.packRegions).toEqual(['miami']);
    expect(miami.packRegionOf(25.77, -80.19)).toBe('miami');
    expect(() => importRegion('atlantis')).toThrow(/unknown import region/);
  });
});
