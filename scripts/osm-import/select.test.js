import { describe, it, expect } from 'vitest';
import { selectPlaces, tierOf, isPocketPark, richness, selectCurated, curatedTierOf, curatedSkip, isChain, roundRobin } from './select.js';
import { importRegion, inVillanovaBox, PHILLY_SHAPE, SF_SHAPE, SJ_DOWNTOWN_SHAPE, SV_TOWNS, nearestNeighborhood } from './regions.js';
import { insideShape, overpassQuery } from './transform.js';

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

describe('curated selection (San Francisco, Silicon Valley)', () => {
  const sfPlace = (id, name, category, topic, extra = {}) => place(id, name, category, topic, { lat: 37.77, lng: -122.42, ...extra });
  const rich = { website: 'https://x', opening_hours: 'Mo-Su 08:00-17:00', cuisine: 'thai' };

  it('ranks researched picks, Wikidata places and culture above bars and food', () => {
    const overrides = { 'osm-n1': { include: { region: 'sf' } } };
    expect(curatedTierOf(sfPlace('osm-n1', 'Starbucks Reserve', 'food', 'café'), { brand: 'Starbucks' }, { overrides })).toBe('curated');
    expect(curatedTierOf(sfPlace('osm-n2', 'SFMOMA', 'art-museums', 'museum', { wikidata: 'Q1' }), {})).toBe('landmark');
    expect(curatedTierOf(sfPlace('osm-n3', 'Small Gallery', 'art-museums', 'art gallery'), { website: 'https://g' })).toBe('culture');
    expect(curatedTierOf(sfPlace('osm-n4', 'Bare Gallery', 'art-museums', 'art gallery'), {})).toBe(null);
    expect(curatedTierOf(sfPlace('osm-n5', 'Trick Dog', 'local-life', 'bar'), rich)).toBe('nightlife');
    expect(curatedTierOf(sfPlace('osm-n6', 'Kin Khao', 'food', 'Thai restaurant'), rich)).toBe('fill');
  });

  it('skips chains, members-only clubs, courts, malls and plaques', () => {
    expect(curatedSkip(sfPlace('osm-n1', 'Starbucks', 'food', 'café'), {})).toBe('chain branch');
    expect(curatedSkip(sfPlace('osm-n2', 'Corner Cafe', 'food', 'café'), { brand: 'Some Chain' })).toBe('chain branch');
    expect(isChain(sfPlace('osm-n3', 'Tartine Manufactory', 'food', 'bakery'))).toBe(false);
    expect(curatedSkip(sfPlace('osm-n4', 'The Battery', 'local-life', 'bar'), { access: 'members' })).toBe('private or members-only');
    expect(curatedSkip(sfPlace('osm-n5', 'Moscone Rec Tennis Courts', 'sports', 'tennis court'), {})).toBe('court or field');
    expect(curatedSkip(sfPlace('osm-n6', 'Westfield', 'local-life', 'mall'), {})).toBe('shop');
    expect(curatedSkip(sfPlace('osm-n7', 'Some Plaque', 'history-culture', 'memorial'), {})).toMatch(/heritage/);
    expect(curatedSkip(sfPlace('osm-n8', 'Old Mint', 'history-culture', 'historic site'), { 'ref:nrhp': '1' })).toBe(null);
  });

  it('takes researched award and tech picks as curated, chain names included, but not courts', () => {
    expect(curatedTierOf(sfPlace('osm-n1', 'Tartine', 'food', 'bakery', { _tier: 'acclaimed' }), {})).toBe('curated');
    expect(curatedTierOf(sfPlace('osm-n2', 'Tartine', 'food', 'bakery', { _tier: 'everyday' }), {})).toBe(null);
    expect(curatedTierOf(sfPlace('osm-n3', 'Tennis Club', 'sports', 'tennis court', { _tier: 'insider' }), {})).toBe(null);
  });

  it('keeps out places with too few sourced facts', () => {
    const places = [sfPlace('osm-n1', 'Award', 'food', 'restaurant', { _tier: 'acclaimed' }), sfPlace('osm-n2', 'Thin', 'food', 'restaurant'), sfPlace('osm-n3', 'Full', 'food', 'restaurant')];
    const counts = { 'osm-n1': 1, 'osm-n2': 1, 'osm-n3': 2 };
    const tagsById = new Map([['osm-n2', rich], ['osm-n3', rich]]);
    const { selected, notSelected } = selectCurated(places, { tagsById, target: 10, minWebFacts: 2, webFactsOf: (p) => counts[p.id] });
    expect(selected.map((p) => p.id)).toEqual(['osm-n1', 'osm-n3']);
    expect(notSelected.find((p) => p.id === 'osm-n2').why).toBe('fewer than 2 sourced facts');
  });

  it('spreads the fill across areas instead of filling from the densest one', () => {
    const e = (id, area, score) => ({ p: { id, area }, score });
    const picked = roundRobin([e('a1', 'A', 9), e('a2', 'A', 8), e('a3', 'A', 7), e('b1', 'B', 3), e('c1', 'C', 4)], 4, (p) => p.area);
    expect(picked.map((x) => x.p.id).sort()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('caps bars at their share, keeps bare records out and hits the target with food', () => {
    const tagsById = new Map();
    const places = [];
    for (let i = 0; i < 10; i++) {
      places.push(sfPlace(`osm-n${100 + i}`, `Bar ${i}`, 'local-life', 'bar'));
      tagsById.set(`osm-n${100 + i}`, rich);
      places.push(sfPlace(`osm-n${200 + i}`, `Food ${i}`, 'food', 'restaurant'));
      tagsById.set(`osm-n${200 + i}`, i < 8 ? rich : {});
    }
    places.push(sfPlace('osm-n300', 'Museum', 'art-museums', 'museum', { wikidata: 'Q9' }));
    const { selected, tiers, notSelected } = selectCurated(places, { tagsById, target: 10, nightlifeShare: 0.2, areaOf: () => 'x' });
    expect(tiers).toEqual({ curated: 0, landmark: 1, culture: 0, nightlife: 2, fill: 7 });
    expect(selected).toHaveLength(10);
    expect(notSelected.find((p) => p.id === 'osm-n209').why).toBe('too few OSM details for its kind');
  });
});

describe('San Francisco and Silicon Valley import areas', () => {
  it('covers San Francisco city proper on land, and nothing past the county line or in the water', () => {
    const sf = importRegion('sf');
    expect(sf.packRegions).toEqual(['san-francisco']);
    for (const [lat, lng] of [
      [37.7956, -122.3935], // Ferry Building
      [37.8087, -122.4098], // Pier 39
      [37.8107, -122.4772], // Fort Point
      [37.7804, -122.5137], // Sutro Baths
      [37.7151, -122.4987], // Fort Funston
      [37.7135, -122.3863], // Candlestick Point
      [37.7286, -122.3577], // Hunters Point
      [37.7598, -122.4148], // Mission
      [37.7694, -122.4862], // Golden Gate Park
      [37.7576, -122.3892], // Dogpatch
    ])
      expect(insideShape(lat, lng, SF_SHAPE)).toBe(true);
    for (const [lat, lng] of [
      [37.6879, -122.4702], // Daly City
      [37.6808, -122.3999], // Brisbane
      [37.8235, -122.3707], // Treasure Island
      [37.8, -122.37], // the bay
      [37.75, -122.53], // the ocean
      [37.8267, -122.4233], // Alcatraz
      [37.8044, -122.2712], // Oakland
    ])
      expect(insideShape(lat, lng, SF_SHAPE)).toBe(false);
    expect(nearestNeighborhood(37.7599, -122.4148)).toBe('Mission');
    expect(nearestNeighborhood(37.8008, -122.4098)).toBe('North Beach');
  });

  it('pulls Silicon Valley town by town plus downtown San Jose', () => {
    const sv = importRegion('sv');
    expect(sv.parts.map((p) => p.name)).toEqual([...SV_TOWNS, 'Downtown San Jose']);
    expect(insideShape(37.3361, -121.8906, SJ_DOWNTOWN_SHAPE)).toBe(true); // Plaza de César Chávez
    expect(insideShape(37.3333, -121.8907, SJ_DOWNTOWN_SHAPE)).toBe(true); // Tech Interactive
    expect(insideShape(37.3209, -121.9473, SJ_DOWNTOWN_SHAPE)).toBe(false); // Santana Row
    expect(overpassQuery(sv.shape, [], { town: 'Palo Alto' })).toContain('["admin_level"="8"]["name"="Palo Alto"](37.15,-122.55,37.7,-121.6)');
  });
});
