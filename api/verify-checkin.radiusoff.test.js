// The check-in radius off for everyone (owner, 2026-11-24): any account's
// check-in verifies, and pays, wherever it was made.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let docs;
const NOW = Date.now();
function ref(path) {
  return { path, get: async () => ({ exists: path in docs, data: () => docs[path] }), collection: (n) => ({ doc: (id) => ref(`${path}/${n}/${id}`) }) };
}
const fakeDb = {
  collection: (n) => ({ doc: (id) => ref(`${n}/${id}`) }),
  batch: () => {
    const ops = [];
    return { update: (r, u) => ops.push(() => (docs[r.path] = { ...docs[r.path], ...u })), set: (r, d) => ops.push(() => (docs[r.path] = d)), commit: async () => ops.forEach((f) => f()) };
  },
};
const pay = vi.fn(async () => ({ awarded: 100 }));
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => ({ uid: 'me', email: 'someone@example.com', emailVerified: true }) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/appCheck.js', () => ({ pointsAppCheckGate: async () => true }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));
vi.mock('./_lib/placePacks.js', () => ({ ensureServerPlacePacks: async () => {} }));
vi.mock('./_lib/streakClock.js', () => ({ userDayKey: async () => '2026-11-24' }));
vi.mock('./_lib/checkinPayout.js', () => ({ payVerifiedCheckin: (...a) => pay(...a) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
vi.mock('../src/data/regions.js', () => ({
  canonicalLandmarkId: (id) => id,
  getLandmark: (region, id) => (id === 'bell' ? { id: 'bell', name: 'Liberty Bell', lat: 39.9496, lng: -75.1503, categories: ['history-culture'] } : null),
}));
const { CHECKIN_RADIUS_ON } = await import('../src/lib/maprConstants.js');
const { checksInAnywhere } = await import('../src/lib/admins.js');
const { default: handler } = await import('./verify-checkin.js');

const call = async (body) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};
const checkin = { userId: 'me', landmarkId: 'bell', region: 'philly', visited: true, ratingOnly: false, createdAt: { toMillis: () => NOW - 30000 } };

describe('check-in radius off for everyone', () => {
  beforeEach(() => {
    docs = { 'checkins/me_bell': { ...checkin } };
    pay.mockClear();
  });

  it('the switch is off, and every signed-in account checks in from anywhere on the phone', () => {
    expect(CHECKIN_RADIUS_ON).toBe(false);
    expect(checksInAnywhere({ uid: 'u', email: 'someone@example.com' })).toBe(true);
    expect(checksInAnywhere(null)).toBe(false);
  });

  it('an ordinary account 5 km away verifies and is paid', async () => {
    const { code, body } = await call({ checkinId: 'me_bell', fix: { lat: 39.9496 + 5000 / 111195, lng: -75.1503, accuracy: 10, timestamp: NOW - 2000 } });
    expect(code).toBe(200);
    expect(body).toMatchObject({ verified: true, reason: null, awarded: 100 });
    expect(docs['checkins/me_bell'].presence).toMatchObject({ verified: true, radiusOff: true });
    expect(pay).toHaveBeenCalledOnce();
  });

  it('with no GPS at all it still verifies', async () => {
    const { body } = await call({ checkinId: 'me_bell' });
    expect(body).toMatchObject({ verified: true, awarded: 100 });
  });
});
