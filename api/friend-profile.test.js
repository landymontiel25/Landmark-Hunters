import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => db, adminBucket: async () => null }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));

const { default: handler } = await import('./friend-profile.js');

const call = async (body) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

beforeEach(() => {
  caller = { uid: 'me', emailVerified: true };
  db = fakeDb({
    'users/ann': { uid: 'ann', public: true },
    'users/bob': { uid: 'bob', public: false },
    'users/stranger': { uid: 'stranger', public: true },
    'users/blocked': { uid: 'blocked', public: true },
    'friend_edges/me_ann': { owner: 'me', friend: 'ann' },
    'friend_edges/ann_me': { owner: 'ann', friend: 'me' },
    'friend_edges/me_bob': { owner: 'me', friend: 'bob' },
    'friend_edges/me_blocked': { owner: 'me', friend: 'blocked' },
    'blocks/blocked_me': { blockerUid: 'blocked', blockedUid: 'me' },
    'streaks/ann': { mode: 'solo', count: 9, best: 20, lastCompletedDay: '2026-11-05', frozenDays: [], freezesLeft: 1, cityId: 'miami', memberIds: ['ann'] },
    'streaks/bob': { mode: 'solo', count: 4, lastCompletedDay: '2026-11-05', frozenDays: [] },
  });
});

describe('solo-streak', () => {
  it('sends a public friend\'s streak with only the three fields it needs', async () => {
    const r = await call({ action: 'solo-streak', uid: 'ann' });
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ soloStreak: { count: 9, lastCompletedDay: '2026-11-05', frozenDays: [] } });
  });
  it('sends nothing for a private profile', async () => {
    expect((await call({ action: 'solo-streak', uid: 'bob' })).body).toEqual({ soloStreak: null, private: true });
  });
  it('is unavailable to a non-friend, a blocked pair and a missing account', async () => {
    for (const uid of ['stranger', 'blocked', 'ghost']) {
      const r = await call({ action: 'solo-streak', uid });
      expect([r.code, r.body.code]).toEqual([404, 'unavailable']);
    }
  });
  it('has no streak to send when the friend has none', async () => {
    db.docs['users/dee'] = { uid: 'dee', public: true };
    db.docs['friend_edges/me_dee'] = { owner: 'me', friend: 'dee' };
    expect((await call({ action: 'solo-streak', uid: 'dee' })).body).toEqual({ soloStreak: null });
  });
});

describe('unfriend', () => {
  it('removes both halves of the friendship', async () => {
    expect((await call({ action: 'unfriend', uid: 'ann' })).code).toBe(200);
    expect(db.docs['friend_edges/me_ann']).toBeUndefined();
    expect(db.docs['friend_edges/ann_me']).toBeUndefined();
    expect(db.docs['friend_edges/me_bob']).toBeDefined();
  });
  it('refuses yourself and a bad uid, and needs sign-in', async () => {
    expect((await call({ action: 'unfriend', uid: 'me' })).code).toBe(400);
    expect((await call({ action: 'unfriend', uid: '../x' })).code).toBe(400);
    caller = null;
    expect((await call({ action: 'unfriend', uid: 'ann' })).code).toBe(401);
  });
});
