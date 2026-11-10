import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let signedIn = true;
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => (signedIn ? { uid: 'me' } : null) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));

const { default: handler, _setRatingIds, _setCustomLookup, _setCatalogLookup } = await import('./landmark-ratings.js');

const GOOGLE_OK = {
  rating: 4.7,
  userRatingCount: 1234,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  reviews: [
    {
      rating: 5,
      text: { text: 'Worth the line.', languageCode: 'en' },
      relativePublishTimeDescription: '2 weeks ago',
      googleMapsUri: 'https://www.google.com/maps/reviews/1',
      authorAttribution: { displayName: 'Ana', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a' },
    },
  ],
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let google;
const fetchMock = vi.fn(async (url) => {
  const u = String(url);
  if (u.includes('places.googleapis.com')) return google();
  throw new Error(`unexpected ${u}`);
});

const call = async (query) => {
  const res = { headers: {}, status: vi.fn(() => res), json: vi.fn(() => res), setHeader: vi.fn((k, v) => (res.headers[k] = v)), end: vi.fn(() => res) };
  await handler({ method: 'GET', headers: { authorization: 'Bearer t' }, query }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0], res };
};

beforeEach(() => {
  signedIn = true;
  process.env.GOOGLE_PLACES_API_KEY = 'g-secret-key';
  _setRatingIds({ 'philly/liberty-bell-center': { googlePlaceId: 'ChIJabc' } });
  _setCatalogLookup(async () => null);
  google = async () => json(GOOGLE_OK);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('api/landmark-ratings', () => {
  it('success: Google, with snippets on the detail screen', async () => {
    const { code, body, res } = await call({ region: 'philly', id: 'liberty-bell-center', detail: '1' });
    expect(code).toBe(200);
    expect(body.sources.google).toMatchObject({ rating: 4.7, count: 1234, url: 'https://maps.google.com/?cid=1' });
    expect(body.sources.google.snippets[0]).toMatchObject({ text: 'Worth the line.', author: 'Ana', url: 'https://www.google.com/maps/reviews/1' });
    expect(res.headers['Cache-Control']).toBe('no-store');
    // Keys never leave the server.
    expect(JSON.stringify(body)).not.toMatch(/secret-key/);
  });

  it('the card request asks for no reviews', async () => {
    const { body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(body.sources.google.snippets).toEqual([]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reviews'))).toBe(false);
    const googleCall = fetchMock.mock.calls.find(([u]) => String(u).includes('googleapis'));
    expect(googleCall[1].headers['X-Goog-FieldMask']).toBe('rating,userRatingCount,googleMapsUri');
  });

  it('Google errors: 200 with no rating, not "no ratings"', async () => {
    google = async () => json({ error: 'boom' }, 500);
    const { code, body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(code).toBe(200);
    expect(body.sources.google).toBeNull();
    expect(body.googleNoRating).toBe(false);
  });

  it('Google down: 200 with null', async () => {
    google = async () => json({}, 503);
    const { code, body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(code).toBe(200);
    expect(body.sources).toEqual({ google: null });
    // A failed lookup is not "no ratings".
    expect(body.googleNoRating).toBe(false);
  });

  it('a landmark with no IDs makes no outside calls', async () => {
    const { body } = await call({ region: 'philly', id: 'somewhere-else' });
    expect(body.sources).toEqual({ google: null });
    expect(body.googleNoRating).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a catalog landmark with no ID is matched on first sight from the name and spot the app sends', async () => {
    const lookup = vi.fn(async () => 'ChIJmatched');
    _setCatalogLookup(lookup);
    const q = { region: 'miami', id: 'art-deco-district', name: 'Art Deco Historic District and Ocean Drive', lat: '25.78', lng: '-80.13' };
    const { body } = await call(q);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ region: 'miami', id: 'art-deco-district', name: q.name, lat: 25.78, lng: -80.13 }));
    expect(body.sources.google).toMatchObject({ rating: 4.7 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('places/ChIJmatched'))).toBe(true);
  });

  it('a landmark that already has an ID is never searched for', async () => {
    const lookup = vi.fn(async () => 'ChIJother');
    _setCatalogLookup(lookup);
    await call({ region: 'philly', id: 'liberty-bell-center', name: 'Liberty Bell Center', lat: '39.9', lng: '-75.1' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a failed catalog match does not say "no ratings"; no match does', async () => {
    _setCatalogLookup(async () => {
      throw new Error('google search 503');
    });
    expect((await call({ region: 'miami', id: 'x1', name: 'X', lat: '1', lng: '2' })).body.googleNoRating).toBe(false);
    _setCatalogLookup(async () => null);
    expect((await call({ region: 'miami', id: 'x1', name: 'X', lat: '1', lng: '2' })).body.googleNoRating).toBe(true);
  });

  it('a source with no rating yet is null', async () => {
    google = async () => json({ googleMapsUri: 'https://maps.google.com/?cid=1' });
    const { body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(body.sources.google).toBeNull();
    expect(body.googleNoRating).toBe(true);
  });

  it('a user-added landmark gets its Google rating through its own saved ID', async () => {
    const lookup = vi.fn(async () => 'ChIJcustom');
    _setCustomLookup(lookup);
    const { body } = await call({ region: 'miami', id: 'custom-1760000000000-abc123' });
    expect(lookup).toHaveBeenCalledWith('custom-1760000000000-abc123');
    expect(body.sources.google).toMatchObject({ rating: 4.7 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('places/ChIJcustom'))).toBe(true);
  });

  it('a user-added landmark with no Google match says so; a failed lookup does not', async () => {
    _setCustomLookup(async () => null);
    expect((await call({ region: 'custom', id: 'custom-1-a' })).body.googleNoRating).toBe(true);
    _setCustomLookup(async () => {
      throw new Error('google search 503');
    });
    expect((await call({ region: 'custom', id: 'custom-1-a' })).body.googleNoRating).toBe(false);
  });

  it('needs sign-in, and rejects a bad landmark id', async () => {
    signedIn = false;
    expect((await call({ region: 'philly', id: 'liberty-bell-center' })).code).toBe(401);
    signedIn = true;
    expect((await call({ region: 'philly', id: '../etc' })).code).toBe(400);
    expect((await call({ region: '', id: 'x' })).code).toBe(400);
  });
});
