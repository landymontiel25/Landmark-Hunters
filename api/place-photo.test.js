import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verify = vi.fn();
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: (...a) => verify(...a) }));
vi.mock('./_lib/cors.js', () => ({ withCors: (h) => h }));
const store = new Map();
let adminMode = 'ok'; // 'ok' | 'missing' | 'broken'
const fakeDb = {
  collection: (c) => ({
    doc: (id) => ({
      get: async () => {
        if (adminMode === 'broken') throw new Error('firestore down');
        const d = store.get(`${c}/${id}`);
        return { exists: !!d, data: () => d };
      },
      set: async (d) => {
        if (adminMode === 'broken') throw new Error('firestore down');
        store.set(`${c}/${id}`, { ...d, verifiedAt: { toMillis: () => Date.now() } });
      },
      delete: async () => void store.delete(`${c}/${id}`),
    }),
  }),
};
vi.mock('./_lib/firebaseAdmin.js', () => ({
  adminDb: () => {
    if (adminMode === 'missing') throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
    return fakeDb;
  },
}));

const { default: handler, namesMatch, ANON_LIMIT } = await import('./place-photo.js');

const realFetch = globalThis.fetch;
let n = 0;

async function call(query, { method = 'GET' } = {}) {
  let status;
  let json;
  const headers = {};
  const res = {
    setHeader: (k, v) => (headers[k] = v),
    status(s) {
      status = s;
      return this;
    },
    json(j) {
      json = j;
    },
  };
  // unique uid per call keeps the shared in-memory rate limiter out of the way
  verify.mockResolvedValue({ uid: `u${n++}` });
  await handler({ method, query, headers: {} }, res);
  return { status, json, headers };
}

const Q = { name: 'Liberty Bell Center', lat: '39.9496', lng: '-75.1503' };
const place = (over = {}) => ({
  displayName: { text: 'Liberty Bell Center' },
  location: { latitude: 39.9496, longitude: -75.1503 },
  photos: [{ name: 'places/abc/photos/xyz', authorAttributions: [{ displayName: 'Jane Doe', uri: '//maps.google.com/maps/contrib/1' }] }],
  ...over,
});

function mockGoogle(places, { photoUri = 'https://lh3.googleusercontent.com/p=s800', mediaOk = true } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('searchText')) return { ok: true, json: async () => ({ places }) };
    return { ok: mediaOk, json: async () => ({ photoUri }) };
  });
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'k';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

describe('namesMatch', () => {
  it('accepts the same place with small differences', () => {
    expect(namesMatch('Liberty Bell', 'The Liberty Bell Center')).toBe(true);
    expect(namesMatch("Joe's Pizza", 'Joes Pizza')).toBe(true);
    expect(namesMatch('Café Rosé', 'Cafe Rose')).toBe(true);
  });
  it('rejects different places', () => {
    expect(namesMatch('Joe Pizza', 'Joe Bakery')).toBe(false);
    expect(namesMatch('Central Park', 'Park')).toBe(false);
    expect(namesMatch('Starbucks', 'Starbucks Reserve Roastery Tasting Room Annex')).toBe(false);
    expect(namesMatch('', 'x')).toBe(false);
  });
});

describe('place-photo route', () => {
  it('rejects non-GET and missing key', async () => {
    expect((await call(Q, { method: 'POST' })).status).toBe(405);
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect((await call(Q)).status).toBe(503);
  });

  // Signed out gets photos too (owner, 2026-11-16), limited per visitor (IP).
  it('answers signed-out visitors, limited per IP', async () => {
    mockGoogle([place()]);
    verify.mockResolvedValue(null);
    const statuses = [];
    const req = { method: 'GET', query: Q, headers: { 'x-forwarded-for': '203.0.113.7' } };
    const res = { setHeader() {}, status: (s) => ({ json: () => statuses.push(s) }) };
    for (let i = 0; i < ANON_LIMIT + 2; i++) await handler(req, res);
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(0, ANON_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another visitor isn't held back by the first one's limit.
    let other;
    await handler({ ...req, headers: { 'x-forwarded-for': '198.51.100.9' } }, { setHeader() {}, status: (s) => ({ json: () => (other = s) }) });
    expect(other).toBe(200);
  });

  it('validates input without calling Google', async () => {
    mockGoogle([place()]);
    expect((await call({ lat: '1', lng: '2' })).status).toBe(400);
    expect((await call({ name: 'X', lat: '', lng: '' })).status).toBe(400);
    expect((await call({ name: 'X', lat: '95', lng: '2' })).status).toBe(400);
    expect((await call({ name: 'X', lat: '1', lng: '200' })).status).toBe(400);
    expect((await call({ name: 'x'.repeat(200), lat: '1', lng: '2' })).status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns url + attributions and caches at the edge only', async () => {
    mockGoogle([place()]);
    const r = await call(Q);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      url: 'https://lh3.googleusercontent.com/p=s800',
      attributions: [{ name: 'Jane Doe', uri: 'https://maps.google.com/maps/contrib/1' }],
    });
    expect(r.headers['Cache-Control']).toMatch(/max-age=0/);
    expect(r.headers['Cache-Control']).toMatch(/s-maxage=10800/);
    const [searchUrl, searchInit] = globalThis.fetch.mock.calls[0];
    expect(searchUrl).toContain('places:searchText');
    expect(searchInit.headers['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.location,places.photos');
    const body = JSON.parse(searchInit.body);
    expect(body.locationBias.circle.radius).toBeLessThanOrEqual(500);
    const mediaUrl = globalThis.fetch.mock.calls[1][0];
    expect(mediaUrl).toContain('/places/abc/photos/xyz/media');
    expect(mediaUrl).toContain('maxWidthPx=800');
    expect(mediaUrl).toContain('skipHttpRedirect=true');
  });

  it('never returns a weakly matching or distant place photo', async () => {
    mockGoogle([place({ displayName: { text: 'Liberty Gift Shop' } })]);
    let r = await call(Q);
    expect(r.json).toEqual({ url: null, attributions: [] });
    // The strict search and the loose second try (both turn it down), and no paid photo call.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls.every(([u]) => u.includes('places:searchText'))).toBe(true);

    mockGoogle([place({ location: { latitude: 40.5, longitude: -75.1503 } })]);
    r = await call(Q);
    expect(r.json.url).toBeNull();

    mockGoogle([place({ photos: [] })]);
    r = await call(Q);
    expect(r.json.url).toBeNull();
  });

  it('picks the first good match among candidates', async () => {
    mockGoogle([place({ displayName: { text: 'Other' } }), place()]);
    expect((await call(Q)).json.url).toBeTruthy();
  });

  it('answers 502 (uncached) when Google fails', async () => {
    mockGoogle([place()], { mediaOk: false });
    const r = await call(Q);
    expect(r.status).toBe(502);
    expect(r.headers['Cache-Control']).toBeUndefined();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('boom');
    });
    expect((await call(Q)).status).toBe(502);
  });

  it('logs the failed step and Google status, never the key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await call(Q);
    mockGoogle([place()], { mediaOk: false });
    await call(Q);
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    });
    await call(Q);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('place-photo:'));
    warn.mockRestore();
    expect(lines.some((l) => l.includes('search failed (Google status 403)'))).toBe(true);
    expect(lines.some((l) => l.includes('image fetch failed (Google status'))).toBe(true);
    expect(lines.some((l) => l.includes('timeout failed (during search)'))).toBe(true);
    expect(lines.join('\n')).not.toContain(process.env.GOOGLE_PLACES_API_KEY + '\n');
  });

  it('drops a non-https photoUri', async () => {
    mockGoogle([place()], { photoUri: 'http://evil.example/x.jpg' });
    expect((await call(Q)).status).toBe(502);
  });

  // 300 in 10 minutes since the Landmarks list loads a page's photos and the
  // next page's up front (owner, 2026-11-16).
  it('rate limits per account', async () => {
    mockGoogle([place()]);
    verify.mockResolvedValue({ uid: 'limited' });
    let last;
    for (let i = 0; i < 302; i++) {
      await handler({ method: 'GET', query: Q, headers: {} }, { setHeader() {}, status: (s) => ({ json: () => (last = s) }) });
    }
    expect(last).toBe(429);
  });
});
