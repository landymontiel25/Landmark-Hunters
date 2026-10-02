import { describe, it, expect } from 'vitest';
import {
  MIAMI_SHAPE,
  insideShape,
  overpassQuery,
  classify,
  isClosed,
  osmHoursToApp,
  factsFromTags,
  factsFromWikidata,
  summaryFor,
  toPlace,
  findCatalogDuplicate,
  dedupeImport,
  importPlaces,
} from './transform.js';
import { isClosedNow } from '../../src/lib/nearbyPicks.js';
import { tierQuestion } from '../../src/lib/ratingFlow.js';
import { INTERESTS } from '../../src/data/regions.js';

const node = (id, tags, lat = 25.7655, lng = -80.2196) => ({ type: 'node', id, lat, lon: lng, tags });

describe('shape', () => {
  it('holds the reference points inside and the Everglades outside', () => {
    expect(insideShape(25.7959, -80.2871)).toBe(true); // MIA
    expect(insideShape(25.7496, -80.2601)).toBe(true); // Coral Gables City Hall
    expect(insideShape(25.6904, -80.1629)).toBe(true); // Key Biscayne village
    expect(insideShape(25.761, -80.4)).toBe(false); // west of Sweetwater
    expect(insideShape(25.9, -80.2)).toBe(false); // north of the shape
  });
  it('puts the polygon into the Overpass query', () => {
    const q = overpassQuery();
    expect(q).toContain(`poly:"${MIAMI_SHAPE.map(([a, b]) => `${a} ${b}`).join(' ')}"`);
    expect(q).toContain('out center tags');
  });
});

describe('classify (category = Mapr tag)', () => {
  const ids = new Set(INTERESTS.map((i) => i.id));
  const cases = [
    [{ amenity: 'restaurant', cuisine: 'cuban' }, 'food', 'Cuban restaurant'],
    [{ amenity: 'restaurant', cuisine: 'seafood;spanish' }, 'food', 'seafood restaurant'],
    [{ amenity: 'cafe' }, 'food', 'café'],
    [{ shop: 'bakery' }, 'food', 'bakery'],
    [{ amenity: 'bar' }, 'local-life', 'bar'],
    [{ amenity: 'nightclub' }, 'local-life', 'nightclub'],
    [{ shop: 'mall' }, 'local-life', 'mall'],
    [{ shop: 'books' }, 'local-life', 'bookstore'],
    [{ amenity: 'cinema' }, 'entertainment', 'movie theater'],
    [{ tourism: 'zoo' }, 'entertainment', 'zoo'],
    [{ leisure: 'stadium' }, 'stadiums', 'stadium'],
    [{ leisure: 'pitch', sport: 'tennis' }, 'sports', 'tennis court'],
    [{ leisure: 'pitch', sport: 'pickleball;tennis' }, 'sports', 'pickleball court'],
    [{ leisure: 'pitch', sport: 'soccer' }, 'sports', 'soccer field'],
    [{ leisure: 'sports_centre', sport: 'tennis' }, 'sports', 'tennis center'],
    [{ leisure: 'park' }, 'parks-nature', 'park'],
    [{ natural: 'beach' }, 'parks-nature', 'beach'],
    [{ tourism: 'museum' }, 'art-museums', 'museum'],
    [{ tourism: 'gallery' }, 'art-museums', 'art gallery'],
    [{ historic: 'monument' }, 'history-culture', 'monument'],
    [{ man_made: 'lighthouse' }, 'history-culture', 'lighthouse'],
    [{ aeroway: 'aerodrome', iata: 'MIA' }, 'airports', 'airport'],
  ];
  it.each(cases)('%j -> %s / %s', (tags, category, topic) => {
    const k = classify(tags);
    expect(k.category).toBe(category);
    expect(k.topic).toBe(topic);
    expect(ids.has(k.category)).toBe(true);
  });
  it('skips what the app does not list', () => {
    expect(classify({ amenity: 'fast_food' })).toBeNull();
    expect(classify({ leisure: 'pitch', sport: 'golf' })).toBeNull();
    expect(classify({ historic: 'memorial', memorial: 'plaque' })).toBeNull();
    expect(classify({ shop: 'convenience' })).toBeNull();
  });
  it('phrases the rating question from the topic', () => {
    expect(tierQuestion({ categories: ['food'], topic: classify({ amenity: 'restaurant', cuisine: 'peruvian' }).topic })).toBe('Do you like Peruvian food?');
  });
});

describe('isClosed', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('drops places their tags mark as gone', () => {
    expect(isClosed({ 'disused:amenity': 'restaurant' }, now)).toBe(true);
    expect(isClosed({ name: 'Joe’s (closed)' }, now)).toBe(true);
    expect(isClosed({ opening_hours: 'closed' }, now)).toBe(true);
    expect(isClosed({ end_date: '2024-05' }, now)).toBe(true);
    expect(isClosed({ shop: 'vacant' }, now)).toBe(true);
  });
  it('keeps open ones', () => {
    expect(isClosed({ amenity: 'cafe', opening_hours: 'Mo-Fr 07:00-15:00' }, now)).toBe(false);
    expect(isClosed({ end_date: '2030' }, now)).toBe(false);
  });
});

describe('osmHoursToApp', () => {
  it('rewrites simple schedules', () => {
    expect(osmHoursToApp('Mo-Fr 11:00-22:00; Sa 10:00-23:30; Su off')).toBe('Mon–Fri 11am–10pm; Sat 10am–11:30pm; Sun closed');
    expect(osmHoursToApp('24/7')).toBe('Open 24 hours');
    expect(osmHoursToApp('Mo-Su 17:00-02:00')).toBe('Mon–Sun 5pm–2am');
  });
  it('leaves out schedules it cannot read exactly', () => {
    expect(osmHoursToApp('Mo-Fr 08:00-17:00; PH off')).toBeNull();
    expect(osmHoursToApp('sunrise-sunset')).toBeNull();
    expect(osmHoursToApp('Jan-Mar Mo-Fr 08:00-17:00')).toBeNull();
    expect(osmHoursToApp('')).toBeNull();
  });
  it('works with the app closed-now check', () => {
    const l = { hours: osmHoursToApp('Mo-Fr 11:00-15:00,17:00-22:00; Sa-Su off') };
    expect(isClosedNow(l, new Date(2026, 9, 1, 12, 0))).toBe(false); // Thu noon
    expect(isClosedNow(l, new Date(2026, 9, 1, 16, 0))).toBe(true); // Thu 4pm gap
    expect(isClosedNow(l, new Date(2026, 9, 1, 18, 0))).toBe(false); // Thu 6pm
    expect(isClosedNow(l, new Date(2026, 9, 3, 12, 0))).toBe(true); // Sat
    const late = { hours: osmHoursToApp('Mo-Su 17:00-02:00') };
    expect(isClosedNow(late, new Date(2026, 9, 2, 1, 0))).toBe(false);
  });
});

describe('facts', () => {
  it('states only what the tags say', () => {
    expect(factsFromTags({ cuisine: 'cuban', start_date: '1971', outdoor_seating: 'yes', 'diet:vegan': 'yes' }, 'food')).toEqual([
      'Serves Cuban food',
      'Opened in 1971',
      'Has outdoor seating',
      'Has vegan options',
    ]);
    expect(factsFromTags({ cuisine: 'coffee_shop' }, 'food')).toEqual(['Serves coffee']);
    expect(factsFromTags({ cuisine: 'seafood;fish' }, 'food')).toEqual(['Serves seafood and fish']);
    expect(factsFromTags({ cuisine: 'mexican;venezuelan;international' }, 'food')).toEqual(['Serves Mexican and Venezuelan food']);
    expect(factsFromTags({ cuisine: 'italian;pizza' }, 'food')).toEqual(['Serves Italian food, plus pizza']);
    expect(factsFromTags({ cuisine: 'burger;sandwich' }, 'food')).toEqual(['Serves burgers and sandwiches']);
    expect(factsFromTags({ cuisine: 'portuguese' }, 'food')).toEqual(['Serves Portuguese food']);
    expect(factsFromTags({ brand: 'The Cheesecake Factory' }, 'food')).toEqual(['Part of the Cheesecake Factory chain']);
    expect(factsFromTags({ leisure: 'pitch', sport: 'tennis;pickleball', surface: 'hard', lit: 'yes' }, 'sports')).toEqual([
      'Set up for tennis and pickleball',
      'Hard surface',
      'Lit for night play',
    ]);
    expect(factsFromTags({ capacity: '64767' }, 'stadiums')).toEqual(['Seats 64,767']);
    expect(factsFromTags({}, 'food')).toEqual([]);
  });
  it('ignores malformed dates', () => {
    expect(factsFromTags({ start_date: 'ca. 1950s' }, 'food')).toEqual([]);
    expect(factsFromTags({ start_date: '3021' }, 'food')).toEqual([]);
  });
  it('reads Wikidata claims with labels', () => {
    const entity = {
      claims: {
        P1619: [{ mainsnak: { datavalue: { value: { time: '+1925-00-00T00:00:00Z', precision: 9 } } } }],
        P84: [{ mainsnak: { datavalue: { value: { id: 'Q1' } } } }],
        P466: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
        P571: [{ rank: 'deprecated', mainsnak: { datavalue: { value: { time: '+1900-00-00T00:00:00Z', precision: 9 } } } }],
      },
    };
    expect(factsFromWikidata(entity, { Q1: 'Walter De Garmo', Q2: 'Miami Hurricanes' }, 'stadiums')).toEqual([
      'Opened in 1925',
      'Designed by Walter De Garmo',
      'Home of Miami Hurricanes',
    ]);
    expect(factsFromWikidata(null)).toEqual([]);
  });
  it('builds the summary from the tags', () => {
    expect(summaryFor({ 'addr:street': 'Southwest 8th Street', 'addr:city': 'Miami' }, 'Cuban restaurant')).toBe('Cuban restaurant on Southwest 8th Street, Miami.');
    expect(summaryFor({}, 'park')).toBe('Park.');
  });
});

describe('toPlace', () => {
  it('matches the catalog landmark format', () => {
    const p = toPlace(node(123, { amenity: 'restaurant', name: ' Versailles  ', cuisine: 'cuban', opening_hours: 'Mo-Su 08:00-23:00', wikidata: 'Q7921874', fee: 'no' }));
    expect(p).toMatchObject({
      id: 'osm-n123',
      name: 'Versailles',
      region: 'miami',
      categories: ['food'],
      topic: 'Cuban restaurant',
      images: [],
      bookingUrl: null,
      source: 'osm',
      osmUrl: 'https://www.openstreetmap.org/node/123',
      hours: 'Mon–Sun 8am–11pm',
      wikidata: 'Q7921874',
      free: true,
    });
    for (const k of ['id', 'popularity', 'name', 'region', 'lat', 'lng', 'categories', 'summary', 'facts', 'free', 'bookingUrl', 'typicalMinutes']) expect(p).toHaveProperty(k);
  });
  it('skips a Wikidata namesake the name already says', () => {
    const p = toPlace(node(8, { aeroway: 'aerodrome', iata: 'MIA', name: 'Miami International Airport' }), { wikidataFacts: ['Opened in 1928', 'Named after Miami'] });
    expect(p.facts).toEqual(['Opened in 1928']);
    const q = toPlace(node(9, { leisure: 'park', name: 'Bayfront Park' }), { wikidataFacts: ['Named after Julia Tuttle'] });
    expect(q.facts).toEqual(['Named after Julia Tuttle']);
  });
  it('leaves facts empty and the fee unknown when OSM has neither', () => {
    const p = toPlace(node(5, { leisure: 'park', name: 'Tiny Park' }));
    expect(p.facts).toEqual([]);
    expect(p.free).toBeNull();
  });
  it('uses the way center', () => {
    const p = toPlace({ type: 'way', id: 9, center: { lat: 25.7, lon: -80.2 }, tags: { leisure: 'park', name: 'A Park' } });
    expect(p).toMatchObject({ id: 'osm-w9', lat: 25.7, lng: -80.2 });
  });
});

describe('duplicates', () => {
  it('finds a catalog landmark of the same name nearby', () => {
    const catalog = [{ id: 'versailles-restaurant', regionId: 'miami', name: 'Versailles Restaurant', lat: 25.7652, lng: -80.2532 }];
    expect(findCatalogDuplicate({ name: 'Versailles', lat: 25.7654, lng: -80.2531 }, catalog)?.id).toBe('versailles-restaurant');
    expect(findCatalogDuplicate({ name: 'Versailles', lat: 25.79, lng: -80.2531 }, catalog)).toBeNull();
    expect(findCatalogDuplicate({ name: 'Joe’s Pizza', lat: 25.7654, lng: -80.2531 }, catalog)).toBeNull();
  });
  it('tells a venue inside a catalog place apart from the place itself', () => {
    const catalog = [
      { id: 'wynwood', regionId: 'miami', name: 'Wynwood', lat: 25.8, lng: -80.2, categories: ['local-life'] },
      { id: 'bayfront-park', regionId: 'miami', name: 'Bayfront Park', lat: 25.775, lng: -80.186 },
      { id: 'panther-coffee-wynwood', regionId: 'miami', name: 'Panther Coffee', lat: 25.801, lng: -80.199, categories: ['food'] },
      { id: 'nu-stadium', regionId: 'miami', name: 'Nu Stadium at Miami Freedom Park', lat: 25.79, lng: -80.25 },
    ];
    expect(findCatalogDuplicate({ name: 'Sha Wynwood', lat: 25.8001, lng: -80.2001, categories: ['food'] }, catalog)).toBeNull();
    expect(findCatalogDuplicate({ name: 'Wynwood Kitchen & Bar', lat: 25.8001, lng: -80.2001, categories: ['food'] }, catalog)).toBeNull();
    expect(findCatalogDuplicate({ name: 'FPL Solar Amphitheater at Bayfront Park', lat: 25.775, lng: -80.186 }, catalog)).toBeNull();
    expect(findCatalogDuplicate({ name: 'Panther Coffee Wynwood', lat: 25.801, lng: -80.199, categories: ['food'] }, catalog)?.id).toBe('panther-coffee-wynwood');
    expect(findCatalogDuplicate({ name: 'Nu Stadium', lat: 25.7901, lng: -80.2501 }, catalog)?.id).toBe('nu-stadium');
  });
  it('keeps one of a place mapped twice', () => {
    const a = toPlace(node(1, { amenity: 'cafe', name: 'Café Demetrio', cuisine: 'coffee_shop' }));
    const b = toPlace({ type: 'way', id: 2, center: { lat: 25.76552, lon: -80.21962 }, tags: { amenity: 'cafe', name: 'Cafe Demetrio' } });
    const { kept, dropped } = dedupeImport([a, b]);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
  });
});

describe('review rules', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('drops generic names and big-box chains, applies overrides', () => {
    const els = [
      node(1, { tourism: 'attraction', name: 'Street Art' }),
      node(2, { shop: 'department_store', name: 'Ross', brand: 'Ross Dress for Less' }),
      node(3, { shop: 'department_store', name: "Macy's" }),
      node(4, { tourism: 'museum', name: 'Lock & Load Miami Range' }),
      node(5, { tourism: 'attraction', name: 'Cruise Port' }),
      node(6, { historic: 'memorial', name: 'Our Heroes -' }),
    ];
    const overrides = { 'osm-n4': { category: 'sports', topic: 'shooting range' }, 'osm-n5': { drop: 'terminal' } };
    const { places, dropped } = importPlaces(els, { overrides, now });
    expect(places.map((p) => p.name).sort()).toEqual(['Lock & Load Miami Range', "Macy's", 'Our Heroes']);
    expect(places.find((p) => p.id === 'osm-n4')).toMatchObject({ categories: ['sports'], topic: 'shooting range' });
    expect(dropped.genericName).toHaveLength(1);
    expect(dropped.chainStore).toHaveLength(1);
    expect(dropped.reviewed[0].why).toBe('terminal');
  });
  it('catches a catalog museum named with extra words', () => {
    const catalog = [{ id: 'frost', regionId: 'miami', name: 'Frost Museum of Science', lat: 25.785, lng: -80.195, categories: ['art-museums'] }];
    expect(findCatalogDuplicate({ name: 'Patricia and Phillip Frost Museum of Science', lat: 25.7851, lng: -80.1951, categories: ['art-museums'] }, catalog)?.id).toBe('frost');
  });
});

describe('importPlaces', () => {
  it('reports every drop with its reason', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const els = [
      node(1, { amenity: 'restaurant', name: 'Open Spot' }),
      node(2, { amenity: 'restaurant' }),
      node(3, { amenity: 'restaurant', name: 'Old Spot', end_date: '2020' }),
      node(4, { amenity: 'restaurant', name: 'Far Spot' }, 26.1, -80.2),
      node(5, { amenity: 'fast_food', name: 'Chain' }),
      node(6, { amenity: 'restaurant', name: 'Versailles' }, 25.7654, -80.2531),
    ];
    const catalog = [{ id: 'versailles-restaurant', regionId: 'miami', name: 'Versailles Restaurant', lat: 25.7652, lng: -80.2532 }];
    const { places, dropped } = importPlaces(els, { catalog, now });
    expect(places.map((p) => p.name)).toEqual(['Open Spot']);
    expect(dropped.noName).toHaveLength(1);
    expect(dropped.closed).toHaveLength(1);
    expect(dropped.outside).toHaveLength(1);
    expect(dropped.notListed).toHaveLength(1);
    expect(dropped.duplicateOfCatalog[0].existing).toBe('miami/versailles-restaurant');
  });
});
