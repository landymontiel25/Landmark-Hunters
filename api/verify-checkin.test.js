import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake firebase-admin: an in-memory doc store with batch writes, so the test
// drives the real handler end to end.
let docs;
let caller = 'me';
const NOW = Date.now();

function ref(path) {
  return {
    path,
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    collection: (n) => ({ doc: (id) => ref(`${path}/${n}/${id}`) }),
  };
}
const fakeDb = {
  collection: (n) => ({ doc: (id) => ref(`${n}/${id}`) }),
  batch: () => {
    const ops = [];
    return {
      update: (r, u) => ops.push(() => (docs[r.path] = { ...docs[r.path], ...u })),
      set: (r, d) => ops.push(() => (docs[r.path] = d)),
      commit: async () => ops.forEach((f) => f()),
    };
  },
};

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => (caller ? { uid: caller } : null) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));
vi.mock('./_lib/placePacks.js', () => ({ ensureServerPlacePacks: async () => {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
vi.mock('../src/data/regions.js', () => ({
  canonicalLandmarkId: (id) => id,
  getLandmark: (region, id) => (id === 'bell' ? { id: 'bell', name: 'Liberty Bell', lat: 39.9496, lng: -75.1503, categories: ['history-culture'] } : null),
}));

const { default: handler } = await import('./verify-checkin.js');

const call = async (body) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};
const fix = (over = {}) => ({ lat: 39.9496, lng: -75.1503, accuracy: 10, timestamp: NOW - 2000, ...over });
const checkin = (over = {}) => ({ userId: 'me', landmarkId: 'bell', region: 'philly', visited: true, ratingOnly: false, createdAt: { toMillis: () => NOW - 30000 }, ...over });

beforeEach(() => {
  caller = 'me';
  docs = { 'checkins/me_bell': checkin() };
});

describe('api/verify-checkin', () => {
  it('verifies a check-in at the place and writes presence, proof and the last fix', async () => {
    const { code, body } = await call({ checkinId: 'me_bell', fix: fix() });
    expect(code).toBe(200);
    expect(body).toMatchObject({ ok: true, verified: true, reason: null });
    expect(docs['checkins/me_bell'].presence).toMatchObject({ verified: true, distanceMeters: 0, accuracyMeters: 10, placeType: 'landmark', verifiedAt: 'ts' });
    expect(docs['checkins/me_bell/proof/main']).toMatchObject({ uid: 'me', lat: 39.9496, verified: true });
    expect(docs['presence_state/me']).toMatchObject({ lat: 39.9496, checkinId: 'me_bell' });
  });

  it('writes the reason on a fail and keeps the last verified fix unchanged', async () => {
    const { body } = await call({ checkinId: 'me_bell', fix: fix({ lat: 39.9496 + 140 / 111195 }) });
    expect(body).toMatchObject({ verified: false, reason: 'too-far' });
    expect(docs['checkins/me_bell'].presence).toMatchObject({ verified: false, reason: 'too-far' });
    expect(docs['checkins/me_bell'].presence.distanceMeters).toBeGreaterThanOrEqual(139);
    expect(docs['presence_state/me']).toBeUndefined();
  });

  it("refuses someone else's check-in, a rating, a missing one, bad input and no sign-in", async () => {
    docs['checkins/you_bell'] = checkin({ userId: 'you' });
    expect((await call({ checkinId: 'you_bell', fix: fix() })).code).toBe(403);
    docs['checkins/me_r'] = checkin({ ratingOnly: true, visited: false });
    expect((await call({ checkinId: 'me_r', fix: fix() })).code).toBe(400);
    expect((await call({ checkinId: 'me_none', fix: fix() })).code).toBe(404);
    expect((await call({ checkinId: 'me_bell', fix: { lat: 'x' } })).code).toBe(400);
    expect((await call({ checkinId: '../x', fix: fix() })).code).toBe(400);
    caller = null;
    expect((await call({ checkinId: 'me_bell', fix: fix() })).code).toBe(401);
    expect(docs['checkins/you_bell'].presence).toBeUndefined();
  });

  it('a check-in older than 10 minutes cannot be verified', async () => {
    docs['checkins/me_bell'] = checkin({ createdAt: { toMillis: () => NOW - 11 * 60000 } });
    const { body } = await call({ checkinId: 'me_bell', fix: fix() });
    expect(body).toMatchObject({ verified: false, reason: 'stale-checkin' });
  });

  it('flags impossible travel from the last verified fix', async () => {
    docs['presence_state/me'] = { lat: 25.76, lng: -80.19, atMs: NOW - 10 * 60000 };
    const { body } = await call({ checkinId: 'me_bell', fix: fix() });
    expect(body).toMatchObject({ verified: false, reason: 'impossible-travel' });
  });

  it('once verified, stays verified', async () => {
    await call({ checkinId: 'me_bell', fix: fix() });
    const { body } = await call({ checkinId: 'me_bell', fix: fix({ accuracy: 900 }) });
    expect(body).toMatchObject({ verified: true, already: true });
    expect(docs['checkins/me_bell'].presence.verified).toBe(true);
  });

  it('loads a user-added landmark from custom_landmarks', async () => {
    docs['checkins/me_c1'] = checkin({ landmarkId: 'c1', region: 'custom' });
    docs['custom_landmarks/c1'] = { name: 'Corner mural', lat: 40, lng: -75 };
    const { body } = await call({ checkinId: 'me_c1', fix: fix({ lat: 40, lng: -75 }) });
    expect(body.verified).toBe(true);
  });
});
