// Imported (OSM) places must behave like catalog landmarks everywhere: lookup,
// check-in radius, the rating question, Mapr tag scoring, nearby picks, the
// swipe-card queue and the Mapr shortlist. One fixture place per category,
// built by the real import transform.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ALL_LANDMARKS, getLandmark, getCatalogVersion, registerPlaces, INTERESTS } from '../data/regions.js';
import { toPlace } from '../../scripts/osm-import/transform.js';
import { isNearEnough, checkinBlockReason } from './checkinRules.js';
import { tierQuestion } from './ratingFlow.js';
import { applyRating, buildShortlist } from './tagScores.js';
import { eligiblePlaces } from './nearbyPicks.js';
import { onboardingRateQueue } from './onboardingRatePicks.js';
import { getChallengesForRegion } from './challenges.js';
import { ensurePlacePacks, isPlacePackId, resetPlacePacksForTest } from './placePacks.js';

const at = (lat, lng) => ({ lat, lng });
const SAMPLES = [
  [{ amenity: 'restaurant', name: 'Test Cuban Kitchen', cuisine: 'cuban' }, at(25.7651, -80.2198)],
  [{ amenity: 'bar', name: 'Test Corner Bar' }, at(25.8001, -80.1990)],
  [{ amenity: 'cinema', name: 'Test Cinema 8', screen: '8' }, at(25.7322, -80.2601)],
  [{ leisure: 'stadium', name: 'Test Field Stadium', capacity: '20000' }, at(25.7581, -80.2389)],
  [{ leisure: 'pitch', sport: 'pickleball', name: 'Test Pickleball Courts', lit: 'yes' }, at(25.7101, -80.2801)],
  [{ leisure: 'park', name: 'Test Bayside Park' }, at(25.7401, -80.2101)],
  [{ tourism: 'museum', name: 'Test History Museum' }, at(25.7751, -80.1901)],
  [{ historic: 'monument', name: 'Test Monument' }, at(25.7701, -80.1851)],
];
const fixtures = SAMPLES.map(([tags, p], i) => toPlace({ type: 'node', id: 900000 + i, lat: p.lat, lon: p.lng, tags }));

describe('registered imported places', () => {
  const before = ALL_LANDMARKS.length;
  const v0 = getCatalogVersion();
  const added = registerPlaces(fixtures);

  it('join the catalog once', () => {
    expect(added).toBe(fixtures.length);
    expect(ALL_LANDMARKS.length).toBe(before + fixtures.length);
    expect(getCatalogVersion()).toBe(v0 + 1);
    expect(registerPlaces(fixtures)).toBe(0);
    expect(ALL_LANDMARKS.length).toBe(before + fixtures.length);
  });

  it('cover every category under test with a real Mapr tag', () => {
    const ids = new Set(INTERESTS.map((i) => i.id));
    expect(new Set(fixtures.map((f) => f.categories[0]))).toEqual(
      new Set(['food', 'local-life', 'entertainment', 'stadiums', 'sports', 'parks-nature', 'art-museums', 'history-culture'])
    );
    for (const f of fixtures) expect(ids.has(f.categories[0])).toBe(true);
  });

  it.each(fixtures.map((f) => [f.categories[0], f]))('%s: lookup, check-in, rating question', (_, f) => {
    expect(isPlacePackId(f.id)).toBe(true);
    expect(getLandmark('miami', f.id)).toBe(f);
    expect(ALL_LANDMARKS.find((l) => l.id === f.id)?.regionId).toBe('miami');
    // Standing on the spot with a good fix: allowed. 2 km away: refused.
    expect(isNearEnough({ lat: f.lat, lng: f.lng, accuracy: 10 }, f)).toBe(true);
    expect(checkinBlockReason({ lat: f.lat + 0.02, lng: f.lng, accuracy: 10 }, f, { required: true })).toBe('too-far');
    expect(tierQuestion(f)).toMatch(/^Do you like /);
  });

  it('moves Mapr tag scores for its category', () => {
    for (const f of fixtures) {
      const next = applyRating({}, f.categories, 'highly-recommend', Date.now());
      expect(next.scores[f.categories[0]]).toBeGreaterThan(0);
    }
  });

  it('shows up in nearby picks and the swipe-card queue', () => {
    for (const f of fixtures) {
      const near = eligiblePlaces({ origin: { lat: f.lat, lng: f.lng }, miles: 0.2 });
      expect(near.some((l) => l.id === f.id)).toBe(true);
    }
    const queue = onboardingRateQueue({ coords: { lat: 25.76, lng: -80.22 }, limit: 400 });
    expect(fixtures.filter((f) => queue.some((l) => l.id === f.id)).length).toBeGreaterThan(0);
  });

  it('can be a Mapr shortlist pick when its tag scores', () => {
    const curated = ALL_LANDMARKS.filter((l) => l.regionId === 'miami' && l.source !== 'osm').map((l) => l.id);
    const profile = { tagScores: { miami: { food: 60 } }, tagScoresAt: { miami: { food: Date.now() } }, tagCounts: { miami: { food: 4 } } };
    const { coldStart, shortlist } = buildShortlist({ profile, region: 'miami', excludeIds: curated });
    expect(coldStart).toBe(false);
    expect(shortlist[0].id).toBe(fixtures[0].id);
  });

  it('stays out of the curated challenges', () => {
    for (const c of getChallengesForRegion('miami')) expect(c.landmarks.some((l) => l.source === 'osm')).toBe(false);
  });
});

describe('ensurePlacePacks', () => {
  beforeEach(() => resetPlacePacksForTest());
  const pack = { region: 'miami', category: 'food', file: 'places/miami/food.test.json', count: 1 };
  const place = toPlace({ type: 'node', id: 777, lat: 25.76, lon: -80.2, tags: { amenity: 'cafe', name: 'Chunk Café' } });

  it('fetches each chunk once and registers it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([place]) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ensurePlacePacks([pack])).toBe(true);
    expect(await ensurePlacePacks([pack])).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/places\/miami\/food\.test\.json$/);
    expect(getLandmark('miami', 'osm-n777')?.name).toBe('Chunk Café');
    vi.unstubAllGlobals();
  });

  it('reports a failed load and retries on the next call', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ensurePlacePacks([pack])).toBe(false);
    expect(await ensurePlacePacks([pack])).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('does nothing with an empty manifest', async () => {
    expect(await ensurePlacePacks([])).toBe(true);
  });
});
