import { describe, it, expect } from 'vitest';
import { selectPlaces, tierOf, isPocketPark, richness } from './select.js';
import { importRegion, inVillanovaBox, PHILLY_SHAPE, SF_SHAPE, SF_NEIGHBORHOODS } from './regions.js';
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

describe('measured parks (minParkAcres)', () => {
  // A square of `side` degrees around (lat, lng), as one outline ring.
  const square = (lat, lng, side) => [[lat, lng], [lat + side, lng], [lat + side, lng + side], [lat, lng + side], [lat, lng]];
  const sf = (id, name, category, topic, lat, lng, extra = {}) => place(id, name, category, topic, { lat, lng, ...extra });
  const areas = {
    'osm-w1': { acres: 12, rings: [square(37.79, -122.44, 0.002)] }, // Alta Plaza Park
    'osm-w2': { acres: 0.3, rings: [square(37.75, -122.42, 0.0005)] }, // a mini park with a Wikidata item
    'osm-w3': { acres: 55, rings: [square(37.766, -122.471, 0.004)] }, // botanical garden
    'osm-w4': { acres: 2, rings: [square(37.7665, -122.4705, 0.0005)] }, // one bed inside it
    'osm-w5': { acres: 3, rings: [square(37.74, -122.43, 0.001)] }, // community garden
  };
  const opts2 = { areas, minParkAcres: 1 };

  it('keeps parks of at least minParkAcres whatever their name, and drops smaller ones even with Wikidata', () => {
    expect(tierOf(sf('osm-w1', 'Alta Plaza Park', 'parks-nature', 'park', 37.791, -122.439), {}, opts2)).toBe('parks');
    expect(tierOf(sf('osm-w2', 'Muriel Leff Mini Park', 'parks-nature', 'park', 37.7502, -122.4198, { wikidata: 'Q3' }), {}, opts2)).toBe(null);
    expect(tierOf(sf('osm-w5', 'Some Community Garden', 'parks-nature', 'garden', 37.7405, -122.4295), {}, opts2)).toBe(null);
    // A park mapped as a point counts only with a Wikidata item.
    expect(tierOf(sf('osm-n9', 'Point Park', 'parks-nature', 'park', 37.7, -122.4), {}, opts2)).toBe(null);
    expect(tierOf(sf('osm-n10', 'Point Park', 'parks-nature', 'park', 37.7, -122.4, { wikidata: 'Q4' }), {}, opts2)).toBe('wikidata');
  });

  it('drops a park or attraction inside a smaller selected place as part of it', () => {
    const garden = sf('osm-w3', 'San Francisco Botanical Garden', 'parks-nature', 'garden', 37.768, -122.469, { wikidata: 'Q5' });
    const bed = sf('osm-w4', 'Moon Viewing Garden', 'parks-nature', 'garden', 37.76675, -122.47025);
    const kiosk = sf('osm-n11', 'Garden Bookstore', 'local-life', 'bookstore', 37.767, -122.47);
    const { selected, notSelected } = selectPlaces([garden, bed, kiosk], { ...opts2, target: 0 });
    expect(selected.map((p) => p.id)).toEqual(['osm-w3', 'osm-n11']);
    expect(notSelected.find((p) => p.id === 'osm-w4').why).toBe('part of San Francisco Botanical Garden');
  });

  it('reports why a park was left out', () => {
    const { notSelected } = selectPlaces([sf('osm-w2', 'Muriel Leff Mini Park', 'parks-nature', 'park', 37.7502, -122.4198, { wikidata: 'Q3' })], opts2);
    expect(notSelected[0].why).toBe('park under 1 acres (0.3)');
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

  it('covers San Francisco from the piers to Ocean Beach, not Alcatraz or Daly City', () => {
    const sf = importRegion('san-francisco');
    expect(sf.packRegions).toEqual(['san-francisco']);
    for (const [lat, lng] of [
      [37.8017, -122.3976], // Exploratorium, Pier 15
      [37.8087, -122.4098], // Pier 39
      [37.7786, -122.3893], // Oracle Park
      [37.7804, -122.5137], // Sutro Baths
      [37.8106, -122.4771], // Fort Point
      [37.7128, -122.3803], // Candlestick Point
      [37.7136, -122.5025], // Fort Funston
    ])
      expect(insideShape(lat, lng, SF_SHAPE)).toBe(true);
    expect(insideShape(37.8267, -122.423, SF_SHAPE)).toBe(false); // Alcatraz
    expect(insideShape(37.7, -122.47, SF_SHAPE)).toBe(false); // Daly City
    expect(insideShape(37.823, -122.37, SF_SHAPE)).toBe(false); // Treasure Island
    expect(insideShape(37.76, -122.515, SF_SHAPE)).toBe(false); // the ocean off Ocean Beach
  });

  it('spreads the San Francisco fill across neighborhoods and kinds', () => {
    const mk = (i, hood, topic) => {
      const [, lat, lng] = SF_NEIGHBORHOODS.find((n) => n[0] === hood);
      return place(`osm-n${100 + i}`, `Place ${i}`, 'food', topic, { lat, lng });
    };
    const places = [mk(1, 'Mission', 'Mexican restaurant'), mk(2, 'Mission', 'Mexican restaurant'), mk(3, 'Mission', 'café'), mk(4, 'Outer Sunset', 'café')];
    const tagsById = new Map(places.map((p) => [p.id, { website: 'https://x' }]));
    // Three picks: one per neighborhood first, then the Mission's other kind.
    const { selected } = selectPlaces(places, { tagsById, target: 3, neighborhoods: SF_NEIGHBORHOODS });
    expect(selected.map((p) => p.id).sort()).toEqual(['osm-n101', 'osm-n103', 'osm-n104']);
  });

  it('keeps Miami as it was', () => {
    const miami = importRegion('miami');
    expect(miami.packRegions).toEqual(['miami']);
    expect(miami.packRegionOf(25.77, -80.19)).toBe('miami');
    expect(() => importRegion('atlantis')).toThrow(/unknown import region/);
  });
});
