// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import {
  DEFAULT_DISTANCE_MI,
  DISTANCE_OPTIONS_MI,
  METERS_PER_MILE,
  PICKS_CACHE_TTL_MS,
  chainedPick,
  composePicks,
  eligiblePlaces,
  fallbackReason,
  hasPhoto,
  isClosedNow,
  lowRatedIds,
  mealPicks,
  moodPlaces,
  nearbyPicksCacheKey,
  pickKey,
  rankNearbyCandidates,
  readNearbyPicksCache,
  selectReady,
  withReasons,
  withinDistance,
  writeNearbyPicksCache,
} from './nearbyPicks';

afterEach(() => localStorage.clear());

const ORIGIN = { lat: 40.0, lng: -75.0 };
// A point `miles` due north of ORIGIN (1 degree of latitude ~ 69.05 miles).
const north = (miles) => ({ lat: ORIGIN.lat + miles / 69.05, lng: ORIGIN.lng });
const place = (id, miles, extra = {}) => ({
  id,
  regionId: 'test',
  name: id,
  categories: ['food'],
  images: [`https://img.example/${id}.jpg`],
  ...north(miles),
  ...extra,
});
const pick = (id, extra = {}) => ({ id, region: 'test', name: id, categories: ['food'], image: `https://img.example/${id}.jpg`, pickType: 'usual', ...extra });

describe('distance filter', () => {
  it('offers 1, 5, 10, 15, 20, 30, 50 and 100 miles, 10 by default', () => {
    expect(DISTANCE_OPTIONS_MI).toEqual([1, 5, 10, 15, 20, 30, 50, 100]);
    expect(DEFAULT_DISTANCE_MI).toBe(10);
  });

  it('keeps only places inside the chosen distance, closest first', () => {
    const places = [place('far', 12), place('near', 0.5), place('mid', 9.5)];
    expect(withinDistance(places, ORIGIN, 10).map((p) => p.id)).toEqual(['near', 'mid']);
    expect(withinDistance(places, ORIGIN, 1).map((p) => p.id)).toEqual(['near']);
    expect(withinDistance(places, ORIGIN, 15).map((p) => p.id)).toEqual(['near', 'mid', 'far']);
  });

  it('includes the edge and attaches each distance', () => {
    const [p] = withinDistance([place('edge', 4.99)], ORIGIN, 5);
    expect(p.distanceMeters).toBeLessThanOrEqual(5 * METERS_PER_MILE);
    expect(withinDistance([place('just-out', 5.05)], ORIGIN, 5)).toEqual([]);
  });

  it('shows nothing without a location', () => {
    expect(withinDistance([place('near', 0.1)], null, 10)).toEqual([]);
  });

  it('never ranks a pick from outside the filter, on real catalog data', () => {
    const villanova = getRegion('villanova').center;
    const now = Date.now();
    const profile = {
      tagScores: { villanova: { 'history-culture': 40, food: 20 } },
      tagScoresAt: { villanova: { 'history-culture': now, food: now } },
      tagCounts: { villanova: { 'history-culture': 8, food: 5 } },
    };
    for (const miles of [1, 10]) {
      const { usual, fresh } = rankNearbyCandidates({ profile, origin: villanova, miles, now });
      expect(usual.length).toBeGreaterThan(0);
      for (const p of [...usual, ...fresh]) expect(p.distanceMeters).toBeLessThanOrEqual(miles * METERS_PER_MILE);
    }
  });
});

describe('photos: loading, missing or broken', () => {
  it('treats a place without an image in its own data as having no photo', () => {
    expect(hasPhoto(place('a', 1))).toBe(true);
    expect(hasPhoto(place('b', 1, { images: [] }))).toBe(false);
    expect(hasPhoto(pick('c', { image: null }))).toBe(false);
    expect(hasPhoto(pick('d', { image: '' }))).toBe(false);
  });

  it('skips a still-loading pick and shows the next one in its place', () => {
    const usual = [pick('u1'), pick('u2-loading'), pick('u3'), pick('u4')];
    const fresh = [pick('n1', { pickType: 'new' })];
    const loaded = new Set(['u1', 'u3', 'u4', 'n1']);
    const shown = composePicks({ usual, fresh, isReady: (p) => loaded.has(p.id) });
    expect(shown.map((p) => p.id)).toEqual(['u1', 'u3', 'n1', 'u4']);
  });

  it('skips a pick with no photo, and a new pick that is loading falls back to the next new one', () => {
    const usual = [pick('u1', { image: null }), pick('u2'), pick('u3'), pick('u4')];
    const fresh = [pick('n1', { pickType: 'new' }), pick('n2', { pickType: 'new' })];
    const shown = composePicks({ usual, fresh, isReady: (p) => p.id !== 'n1' });
    expect(shown.map((p) => p.id)).toEqual(['u2', 'u3', 'n2', 'u4']);
  });

  it('the other rows skip a still-loading photo but keep a place with no photo (shown on a tile)', () => {
    const rows = [pick('a'), pick('b', { image: null }), pick('c'), pick('d')];
    expect(selectReady(rows, (p) => p.id !== 'c', 3).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });

  it('keeps places with no photo in the pool, but never as a top pick', () => {
    const landmarks = [place('has', 1), place('none', 1, { images: [] })];
    const ids = eligiblePlaces({ origin: ORIGIN, miles: 10, landmarks }).map((p) => p.id);
    expect(ids).toEqual(['has', 'none']);
    const shown = composePicks({ usual: [pick('none', { image: null }), pick('has')], fresh: [] });
    expect(shown.map((p) => p.id)).toEqual(['has']);
  });

  it('a chained pick never lands on a place with no photo', () => {
    const links = [{ from: 'art-museums', to: 'food', count: 3 }];
    const usual = [pick('bare', { image: null }), pick('photo')];
    expect(chainedPick({ usual, links, lastCategory: 'art-museums' }).id).toBe('photo');
  });
});

describe('mood "Something to eat" finds real nearby food places', () => {
  // Regression: every Villanova food spot (Campus Corner, The Grog Grill,
  // Hope's Cookies) ships without a photo, and the pool used to drop
  // photo-less places, so the mood row said "Nothing for that mood within
  // your distance" right next to them.
  const campusCorner = ALL_LANDMARKS.find((l) => l.regionId === 'villanova' && l.id === 'campus-corner');
  const nearby = { lat: campusCorner.lat + 0.02, lng: campusCorner.lng }; // ~1.4 mi north

  it('Campus Corner is a food place with no photo, and within 10 miles of here', () => {
    expect(campusCorner.categories).toContain('food');
    expect(hasPhoto(campusCorner)).toBe(false);
  });

  it('shows up for the eat mood and the meal card at the default 10 miles', () => {
    const pool = eligiblePlaces({ origin: nearby, miles: DEFAULT_DISTANCE_MI, date: new Date(2026, 8, 29, 12) });
    const eat = moodPlaces({ moodId: 'eat', pool, limit: 50 }).map((p) => p.id);
    expect(eat).toContain('campus-corner');
    expect(mealPicks({ pool, limit: 50 }).map((p) => p.id)).toContain('campus-corner');
    // ...and the row keeps it rather than skipping it for having no photo.
    expect(selectReady(moodPlaces({ moodId: 'eat', pool, limit: 50 }), () => false).map((p) => p.id)).toContain('campus-corner');
  });
});

describe('mostly usual, one something new', () => {
  it('orders usual, usual, new, usual so the top three hold the one new pick', () => {
    const usual = ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => pick(id));
    const fresh = ['n1', 'n2'].map((id) => pick(id, { pickType: 'new' }));
    const shown = composePicks({ usual, fresh });
    expect(shown.map((p) => p.pickType)).toEqual(['usual', 'usual', 'new', 'usual']);
  });

  it('puts a chained pick first, labeled with the link that produced it', () => {
    const usual = [pick('u1'), pick('cafe', { categories: ['local-life'] }), pick('u3'), pick('u4')];
    const fresh = [pick('n1', { pickType: 'new', categories: ['parks-nature'] })];
    const links = [{ from: 'art-museums', to: 'local-life', count: 4 }];
    const chained = chainedPick({ usual, fresh, links, lastCategory: 'art-museums' });
    expect(chained.chain).toEqual({ from: 'art-museums', to: 'local-life', count: 4 });
    const shown = composePicks({ usual, fresh, chained });
    expect(shown.map((p) => p.id)).toEqual(['cafe', 'u1', 'n1', 'u3']);
    // One way: coming from local-life, that link doesn't apply.
    expect(chainedPick({ usual, fresh, links, lastCategory: 'local-life' })).toBeNull();
  });
});

describe('closed places and low ratings', () => {
  const tuesday = (h, m = 0) => new Date(2026, 8, 29, h, m); // 2026-09-29 is a Tuesday

  it('reads common hours lines', () => {
    const hours = 'Mon–Sat 10am–11pm, Sun 12pm–8pm';
    expect(isClosedNow({ hours }, tuesday(12))).toBe(false);
    expect(isClosedNow({ hours }, tuesday(23, 30))).toBe(true);
    expect(isClosedNow({ hours: 'Open 24 hours' }, tuesday(3))).toBe(false);
    expect(isClosedNow({ hours: 'Daily 6pm-2am' }, tuesday(1))).toBe(false);
    expect(isClosedNow({ hours: 'Daily 6pm-2am' }, tuesday(15))).toBe(true);
    expect(isClosedNow({ hours: 'Closed Tuesdays' }, tuesday(12))).toBe(true);
    expect(isClosedNow({ permanentlyClosed: true }, tuesday(12))).toBe(true);
  });

  it('keeps a late-night range open past midnight into the next day', () => {
    // Tuesday 1am is still Monday night's session.
    expect(isClosedNow({ hours: 'Mon-Sat 6pm-2am' }, tuesday(1))).toBe(false);
    expect(isClosedNow({ hours: 'Mon 6pm-2am' }, tuesday(1))).toBe(false);
    expect(isClosedNow({ hours: 'Mon 6pm-2am' }, tuesday(3))).toBe(true);
    // Sunday 1am is Saturday night's session; Sunday is otherwise closed.
    const sunday1am = new Date(2026, 9, 4, 1, 0);
    expect(isClosedNow({ hours: 'Sat 6pm-2am, Sun closed' }, sunday1am)).toBe(false);
  });

  it('treats missing or unreadable hours as open', () => {
    expect(isClosedNow({}, tuesday(3))).toBe(false);
    expect(isClosedNow({ hours: 'Varies by season' }, tuesday(3))).toBe(false);
  });

  it('rules out places rated 2 stars or lower, and keeps better-rated ones', () => {
    const reviews = {
      a: { landmarkId: 'a', ratingTier: 'probably-skip' },
      b: { landmarkId: 'b', ratingTier: 'worth-trying' },
      c: { landmarkId: 'c', stars: 2 },
      d: { landmarkId: 'd', ratingTier: 'highly-recommend' },
    };
    expect(lowRatedIds(reviews).sort()).toEqual(['a', 'c']);
    const landmarks = ['a', 'b', 'c', 'd'].map((id) => place(id, 1));
    const ids = eligiblePlaces({ origin: ORIGIN, miles: 5, lowRated: lowRatedIds(reviews), landmarks }).map((p) => p.id);
    expect(ids.sort()).toEqual(['b', 'd']);
  });

  it('drops a closed place from the pool', () => {
    const landmarks = [place('open', 1), place('shut', 1, { hours: 'Closed Tuesdays' })];
    expect(eligiblePlaces({ origin: ORIGIN, miles: 5, landmarks, date: tuesday(12) }).map((p) => p.id)).toEqual(['open']);
  });
});

describe('fallback reason', () => {
  it('uses the AI line when there is one for that exact pick', () => {
    const [p] = withReasons([pick('a')], { 'test/a': 'Crisp croissants two blocks away.' });
    expect(p).toMatchObject({ reason: 'Crisp croissants two blocks away.', reasonSource: 'ai' });
  });

  it('falls back to a plain line when the call failed, skipped a pick, or sent a blank', () => {
    const picks = [pick('a'), pick('b', { pickType: 'new', categories: ['parks-nature'] }), pick('c')];
    const out = withReasons(picks, { 'test/c': '   ', 'test/zzz': 'not ours' });
    expect(out.map((p) => p.reasonSource)).toEqual(['fallback', 'fallback', 'fallback']);
    expect(out[0].reason).toBe('Food is one of your favorite kinds of places.');
    expect(out[1].reason).toBe('Something new for you: Parks & Nature.');
    expect(withReasons(picks, undefined).every((p) => p.reason && p.reasonSource === 'fallback')).toBe(true);
  });

  it('explains a chained pick by its link', () => {
    expect(fallbackReason(pick('a', { chain: { from: 'art-museums', to: 'food', count: 3 } }))).toBe(
      'You often go for Food after Art & Museums.'
    );
  });
});

describe('mood sort and the cached set', () => {
  it('sorts a mood closest first or by highest rating', () => {
    const pool = withinDistance([place('near', 1), place('far', 3), place('park', 2, { categories: ['parks-nature'] })], ORIGIN, 10);
    const ratings = { far: { avg: 4.9, count: 10 }, near: { avg: 3.1, count: 4 } };
    expect(moodPlaces({ moodId: 'eat', pool, sort: 'closest', ratings }).map((p) => p.id)).toEqual(['near', 'far']);
    expect(moodPlaces({ moodId: 'eat', pool, sort: 'rated', ratings }).map((p) => p.id)).toEqual(['far', 'near']);
  });

  it('keeps the last set and marks it stale after 4 hours', () => {
    const key = nearbyPicksCacheKey({ uid: 'u', ratingsCount: 12, origin: ORIGIN, miles: 10 });
    writeNearbyPicksCache(key, [pick('a')], 1000);
    expect(readNearbyPicksCache(key, 1000 + 60_000)).toMatchObject({ stale: false, picks: [{ id: 'a' }] });
    expect(readNearbyPicksCache(key, 1000 + PICKS_CACHE_TTL_MS + 1)).toMatchObject({ stale: true, picks: [{ id: 'a' }] });
    expect(pickKey(pick('a'))).toBe('test/a');
  });
});
