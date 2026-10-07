import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Place-ID cache behaviour of api/place-photo.js (Admin SDK + fetch mocked).
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

const { default: handler } = await import('./place-photo.js');

const realFetch = globalThis.fetch;
let n = 0;

async function call(query) {
  let status;
  let json;
  const res = {
    setHeader() {},
    status(s) {
      status = s;
      return this;
    },
    json(j) {
      json = j;
    },
  };
  verify.mockResolvedValue({ uid: `c${n++}` }); // fresh uid per call: rate limiter stays out of the way
  await handler({ method: 'GET', query, headers: {} }, res);
  return { status, json };
}

const Q = { name: 'Liberty Bell Center', lat: '39.9496', lng: '-75.1503' };
const KEY = 'place_ids/sf__lm1';
const CQ = { ...Q, region: 'sf', id: 'lm1' };
const DAY = 24 * 60 * 60 * 1000;
const PHOTO_URI = 'https://lh3.googleusercontent.com/p=s800';
const PHOTOS = [{ name: 'places/abc/photos/xyz', authorAttributions: [{ displayName: 'Jane Doe', uri: '//maps.google.com/maps/contrib/1' }] }];
const place = (over = {}) => ({
  id: 'ChIJnew',
  displayName: { text: 'Liberty Bell Center' },
  location: { latitude: 39.9496, longitude: -75.1503 },
  photos: PHOTOS,
  ...over,
});
const seeded = (over = {}) => ({
  placeId: 'ChIJold',
  matchedName: 'Liberty Bell Center',
  lat: 39.9496,
  lng: -75.1503,
  source: 'text-search',
  status: 'ok',
  verifiedAt: { toMillis: () => Date.now() - DAY },
  ...over,
});

// searchText -> places; GET /places/{id} -> details; media -> PHOTO_URI
function mockApi({ places = [place()], detailsStatus = 200 } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('searchText')) return { ok: true, status: 200, json: async () => ({ places }) };
    if (u.includes('/media')) return { ok: true, status: 200, json: async () => ({ photoUri: PHOTO_URI }) };
    if (u.includes('/v1/places/')) return { ok: detailsStatus === 200, status: detailsStatus, json: async () => ({ photos: PHOTOS }) };
    throw new Error(`unexpected ${u}`);
  });
}
const calls = (needle) =>
  globalThis.fetch.mock.calls.filter(([u]) => String(u).includes(needle) && (needle === '/media' || !String(u).includes('/media')));

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  store.clear();
  adminMode = 'ok';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_PLACES_API_KEY;
  vi.restoreAllMocks();
});

describe('place-ID cache', () => {
  it('a miss does one Text Search and stores only the place ID + match metadata', async () => {
    mockApi();
    const r = await call(CQ);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(calls('searchText')).toHaveLength(1);
    const doc = store.get(KEY);
    expect(doc).toMatchObject({ placeId: 'ChIJnew', matchedName: 'Liberty Bell Center', lat: 39.9496, lng: -75.1503, source: 'text-search', status: 'ok' });
    // no photo data of any kind in the cache doc
    expect(Object.keys(doc).sort()).toEqual(['lat', 'lng', 'matchedName', 'placeId', 'source', 'status', 'verifiedAt']);
    const dump = JSON.stringify(doc);
    expect(dump).not.toContain('photos/');
    expect(dump).not.toContain('googleusercontent');
    expect(dump).not.toContain('Jane Doe');
  });

  it('a hit skips Text Search and uses Place Details with the photos-only mask', async () => {
    store.set(KEY, seeded());
    mockApi();
    const r = await call(CQ);
    expect(r.json).toEqual({ url: PHOTO_URI, attributions: [{ name: 'Jane Doe', uri: 'https://maps.google.com/maps/contrib/1' }] });
    expect(calls('searchText')).toHaveLength(0);
    const [detailsUrl, init] = calls('/v1/places/')[0];
    expect(detailsUrl).toContain('/v1/places/ChIJold');
    expect(init.headers['X-Goog-FieldMask']).toBe('photos');
    expect(calls('/media')).toHaveLength(1);
    expect(store.get(KEY).placeId).toBe('ChIJold'); // untouched
  });

  it('an ID older than the refresh window is re-verified (free) and its verifiedAt bumped', async () => {
    store.set(KEY, seeded({ verifiedAt: { toMillis: () => Date.now() - 400 * DAY } }));
    mockApi();
    await call(CQ);
    expect(calls('searchText')).toHaveLength(0);
    expect(store.get(KEY).verifiedAt.toMillis()).toBeGreaterThan(Date.now() - 5000);
  });

  it('an obsolete stored ID triggers exactly one re-lookup and stores the new ID', async () => {
    store.set(KEY, seeded());
    mockApi({ detailsStatus: 404 });
    const r = await call(CQ);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(calls('/v1/places/')).toHaveLength(1);
    expect(calls('searchText')).toHaveLength(1);
    expect(store.get(KEY).placeId).toBe('ChIJnew');
  });

  it('a transient Place Details failure answers 502 and keeps the stored ID', async () => {
    store.set(KEY, seeded());
    mockApi({ detailsStatus: 500 });
    expect((await call(CQ)).status).toBe(502);
    expect(calls('searchText')).toHaveLength(0);
    expect(store.get(KEY).placeId).toBe('ChIJold');
  });

  it('a no-match is stored and suppresses re-search until its retry window passes', async () => {
    mockApi({ places: [place({ displayName: { text: 'Liberty Gift Shop' } })] });
    let r = await call(CQ);
    expect(r.json).toEqual({ url: null, attributions: [] });
    expect(store.get(KEY)).toMatchObject({ status: 'no-match', placeId: null });
    expect(calls('searchText')).toHaveLength(1);

    r = await call(CQ);
    expect(r.json).toEqual({ url: null, attributions: [] });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // the second request made no Google call

    store.set(KEY, { ...store.get(KEY), verifiedAt: { toMillis: () => Date.now() - 31 * DAY } });
    mockApi();
    r = await call(CQ);
    expect(calls('searchText')).toHaveLength(1);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(store.get(KEY)).toMatchObject({ status: 'ok', placeId: 'ChIJnew' });
  });

  it('a no-match from a different (junk) name does not hide the real landmark', async () => {
    mockApi({ places: [] });
    await call({ ...CQ, name: 'zzzz junk' });
    expect(store.get(KEY)).toMatchObject({ status: 'no-match', matchedName: 'zzzz junk' });
    mockApi();
    const r = await call(CQ);
    expect(calls('searchText')).toHaveLength(1);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(store.get(KEY)).toMatchObject({ status: 'ok', placeId: 'ChIJnew' });
  });

  it('an old no-match doc without a name is searched again once', async () => {
    store.set(KEY, { status: 'no-match', placeId: null, matchedName: null, lat: Number(CQ.lat), lng: Number(CQ.lng), verifiedAt: { toMillis: () => Date.now() } });
    mockApi();
    const r = await call(CQ);
    expect(calls('searchText')).toHaveLength(1);
    expect(r.json.url).toBe(PHOTO_URI);
  });

  it('ignores a stored ID when the request no longer describes the same place', async () => {
    store.set(KEY, seeded());
    mockApi();
    await call({ ...CQ, name: 'Totally Different Cafe' });
    expect(calls('/v1/places/')).toHaveLength(0);
    expect(calls('searchText')).toHaveLength(1);
    await call({ ...CQ, lat: '40.5' });
    expect(calls('/v1/places/')).toHaveLength(0);
  });

  it('without region/id (or with an unsafe one) it behaves as before and never touches the cache', async () => {
    mockApi();
    await call(Q);
    await call({ ...Q, region: 'sf', id: '../x' });
    await call({ ...Q, region: 'a/b', id: 'x' });
    expect(store.size).toBe(0);
    expect(calls('searchText')).toHaveLength(3);
  });

  it('falls back to a plain Text Search when Admin credentials are missing', async () => {
    adminMode = 'missing';
    mockApi();
    const r = await call(CQ);
    expect(r.status).toBe(200);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(calls('searchText')).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('place-ID cache disabled'));
  });

  it('falls back to a plain Text Search when Firestore fails', async () => {
    adminMode = 'broken';
    mockApi();
    const r = await call(CQ);
    expect(r.status).toBe(200);
    expect(r.json.url).toBe(PHOTO_URI);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('place-ID cache read failed'));
  });
});
