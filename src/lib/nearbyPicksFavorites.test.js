import { describe, it, expect } from 'vitest';
import { FAVORITE_RADIUS_MI, favoritePlaces, fallbackReason, mergeFavorites, rankNearbyCandidates } from './nearbyPicks';

// Miracle Mile, Coral Gables. 0.01 degree of latitude is about 0.69 mile.
const here = { lat: 25.75, lng: -80.26 };
const north = (miles) => here.lat + miles / 69;
const place = (id, miles, extra = {}) => ({
  id,
  regionId: 'test',
  name: id,
  lat: north(miles),
  lng: here.lng,
  categories: ['food'],
  images: [`https://img.example/${id}.jpg`],
  ...extra,
});
const loved = (id) => ({ ratingTier: 'highly-recommend', landmarkId: id });
const okay = (id) => ({ ratingTier: 'worth-trying', landmarkId: id });
const reviews = (...rs) => Object.fromEntries(rs.map((r) => [r.landmarkId, r]));
const LANDMARKS = [place('hillstone', 0.5), place('far-fave', 1.6), place('meh', 0.3), place('here', 0.01), place('second', 0.8), place('new-spot', 0.4)];

describe('favoritePlaces', () => {
  it('returns loved places within a mile, best rated first then closest', () => {
    const favs = favoritePlaces({ origin: here, miles: 10, myReviews: reviews(loved('hillstone'), loved('second')), landmarks: LANDMARKS });
    expect(favs.map((f) => f.id)).toEqual(['hillstone', 'second']);
    expect(favs[0]).toMatchObject({ favorite: true, favoriteStars: 5, pickType: 'usual' });
  });

  it('skips a loved place past a mile, an okay one, and the one you are standing at', () => {
    const favs = favoritePlaces({
      origin: here,
      miles: 10,
      myReviews: reviews(loved('far-fave'), okay('meh'), loved('here'), loved('hillstone')),
      landmarks: LANDMARKS,
    });
    expect(favs.map((f) => f.id)).toEqual(['hillstone']);
  });

  it('never reaches further than the distance filter', () => {
    const favs = favoritePlaces({ origin: here, miles: 0.4, myReviews: reviews(loved('hillstone')), landmarks: LANDMARKS });
    expect(favs).toEqual([]);
    expect(FAVORITE_RADIUS_MI).toBe(1);
  });

  it('finds a loved place the user added by hand', () => {
    const custom = { id: 'tapia', region: 'custom', name: 'Tapia Peruvian Restaurant', lat: north(0.2), lng: here.lng, categories: ['food'], images: ['https://img.example/t.jpg'] };
    const favs = favoritePlaces({ origin: here, miles: 5, myReviews: reviews(loved('tapia')), landmarks: LANDMARKS, extraPlaces: [custom] });
    expect(favs.map((f) => f.id)).toEqual(['tapia']);
  });

  it('is empty without a location or without ratings', () => {
    expect(favoritePlaces({ origin: null, miles: 5, myReviews: reviews(loved('hillstone')), landmarks: LANDMARKS })).toEqual([]);
    expect(favoritePlaces({ origin: here, miles: 5, myReviews: {}, landmarks: LANDMARKS })).toEqual([]);
  });
});

describe('mergeFavorites', () => {
  const pk = (id, pickType = 'usual', extra = {}) => ({ id, region: 'test', pickType, ...extra });
  const fav = (id, stars = 5) => ({ ...pk(id), favorite: true, favoriteStars: stars, distanceMeters: 500 });
  const base = [pk('u1'), pk('u2'), pk('n1', 'new'), pk('u3')];

  it('puts two favorites first and keeps the one new pick third', () => {
    const merged = mergeFavorites(base, [fav('f1'), fav('f2'), fav('f3')]);
    expect(merged.map((p) => p.id)).toEqual(['f1', 'f2', 'n1', 'u1']);
  });

  it('with one favorite: favorite, usual, new, usual', () => {
    const merged = mergeFavorites(base, [fav('f1')]);
    expect(merged.map((p) => p.id)).toEqual(['f1', 'u1', 'n1', 'u2']);
  });

  it('replaces a stale favorite from a cached set and gives favorites a plain reason', () => {
    const cached = [fav('old'), ...base];
    const merged = mergeFavorites(cached, [fav('f1')]);
    expect(merged.map((p) => p.id)).not.toContain('old');
    expect(merged[0]).toMatchObject({ id: 'f1', reasonSource: 'fallback' });
    expect(merged[0].reason).toMatch(/^You loved this place\./);
  });

  it('drops cached favorites when there are none now, and leaves null alone', () => {
    expect(mergeFavorites([fav('old'), ...base], []).map((p) => p.id)).toEqual(['u1', 'u2', 'n1', 'u3']);
    expect(mergeFavorites(null, [fav('f1')])).toBeNull();
  });

  it('does not duplicate a favorite already in the list', () => {
    const merged = mergeFavorites([pk('f1'), ...base], [fav('f1')]);
    expect(merged.filter((p) => p.id === 'f1')).toHaveLength(1);
  });
});

describe('fallbackReason for a favorite', () => {
  it('says what the user did, with the distance in their units', () => {
    expect(fallbackReason({ favorite: true, favoriteStars: 5, categories: ['food'], distanceMeters: 800 }, 'imperial')).toBe('You loved this place. 0.5 mi away.');
    expect(fallbackReason({ favorite: true, favoriteStars: 4, categories: ['food'] })).toBe('You rated this 4 stars.');
  });
});

describe('rankNearbyCandidates', () => {
  it('returns the favorites alongside the usual and new queues', () => {
    const r = rankNearbyCandidates({ profile: {}, origin: here, miles: 5, myReviews: reviews(loved('hillstone')), now: Date.now() });
    expect(Array.isArray(r.favorites)).toBe(true);
    expect(Array.isArray(r.usual)).toBe(true);
  });
});
