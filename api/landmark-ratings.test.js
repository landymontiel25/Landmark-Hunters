import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let signedIn = true;
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => (signedIn ? { uid: 'me' } : null) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));

const { default: handler, _setRatingIds, _setCustomLookup } = await import('./landmark-ratings.js');

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
const TA_LOCATION = {
  id: 60763,
  traveler_ratings: { overall: { rating: 4.5, count: 890, icon_url: 'https://static.tacdn.com/img2/ratings/traveler/4.5.svg' } },
  urls: { tripadvisor: { main: 'https://www.tripadvisor.com/Attraction_Review-60763' } },
};
const TA_REVIEWS = {
  data: [
    { id: 1, rating: 5, text: [{ language: 'en', value: 'A must see.' }], publish_ts: '2026-09-01T10:00:00Z', user: { username: 'traveler1' }, url: 'https://www.tripadvisor.com/ShowUserReviews-1' },
    { id: 2, rating: 4, text: [{ language: 'en', value: 'Good.' }], publish_ts: '2026-09-02T10:00:00Z' },
  ],
  pagination: { page: 1 },
};

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let google;
let tripadvisor;
const fetchMock = vi.fn(async (url) => {
  const u = String(url);
  if (u.includes('places.googleapis.com')) return google();
  if (u.includes('/reviews')) return tripadvisor.reviews();
  if (u.includes('terra.tripadvisor.com')) return tripadvisor.location();
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
  process.env.TRIPADVISOR_API_KEY = 'ta-secret-key';
  _setRatingIds({ 'philly/liberty-bell-center': { googlePlaceId: 'ChIJabc', tripadvisorLocationId: '60763' } });
  google = async () => json(GOOGLE_OK);
  tripadvisor = { location: async () => json(TA_LOCATION), reviews: async () => json(TA_REVIEWS) };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('api/landmark-ratings', () => {
  it('success: both sources, with snippets on the detail screen', async () => {
    const { code, body, res } = await call({ region: 'philly', id: 'liberty-bell-center', detail: '1' });
    expect(code).toBe(200);
    expect(body.sources.google).toMatchObject({ rating: 4.7, count: 1234, url: 'https://maps.google.com/?cid=1' });
    expect(body.sources.google.snippets[0]).toMatchObject({ text: 'Worth the line.', author: 'Ana', url: 'https://www.google.com/maps/reviews/1' });
    expect(body.sources.tripadvisor).toMatchObject({ rating: 4.5, count: 890, url: 'https://www.tripadvisor.com/Attraction_Review-60763' });
    // Only the 5-bubble review is quoted, with its date.
    expect(body.sources.tripadvisor.snippets).toEqual([expect.objectContaining({ text: 'A must see.', date: '2026-09-01' })]);
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

  it('one source down: Google errors, Tripadvisor still answers', async () => {
    google = async () => json({ error: 'boom' }, 500);
    const { code, body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(code).toBe(200);
    expect(body.sources.google).toBeNull();
    expect(body.googleNoRating).toBe(false);
    expect(body.sources.tripadvisor).toMatchObject({ rating: 4.5 });
  });

  it('one source down: Tripadvisor throws (network), Google still answers', async () => {
    tripadvisor.location = async () => {
      throw new TypeError('fetch failed');
    };
    const { code, body } = await call({ region: 'philly', id: 'liberty-bell-center', detail: '1' });
    expect(code).toBe(200);
    expect(body.sources.tripadvisor).toBeNull();
    expect(body.sources.google).toMatchObject({ rating: 4.7 });
  });

  it('both down: 200 with both null', async () => {
    google = async () => json({}, 503);
    tripadvisor.location = async () => json({}, 404);
    const { code, body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(code).toBe(200);
    expect(body.sources).toEqual({ google: null, tripadvisor: null });
    // A failed lookup is not "no ratings".
    expect(body.googleNoRating).toBe(false);
  });

  it('a landmark with no IDs makes no outside calls', async () => {
    const { body } = await call({ region: 'philly', id: 'somewhere-else' });
    expect(body.sources).toEqual({ google: null, tripadvisor: null });
    expect(body.googleNoRating).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a missing key means that source is null, not an error', async () => {
    delete process.env.TRIPADVISOR_API_KEY;
    const { body } = await call({ region: 'philly', id: 'liberty-bell-center' });
    expect(body.sources.tripadvisor).toBeNull();
    expect(body.sources.google).not.toBeNull();
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
