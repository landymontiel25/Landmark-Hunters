import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { prior: [], written: null };

vi.mock('./firebase', () => ({ db: {}, storage: {} }));
vi.mock('./friends', () => ({ getUserProfile: vi.fn() }));
vi.mock('firebase/storage', () => ({}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  getDocs: async () => ({ size: state.prior.length, docs: state.prior.map((x) => ({ id: x.__id, data: () => x })) }),
  runTransaction: async (_db, fn) =>
    fn({
      get: async () => ({ exists: () => false }),
      set: (ref, data) => {
        if (ref.col === 'checkins') state.written = { id: ref.id, ...data };
      },
    }),
  serverTimestamp: () => 'ts',
  increment: (n) => n,
  setDoc: () => Promise.resolve(),
  getDoc: vi.fn(),
  writeBatch: vi.fn(),
  onSnapshot: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  updateDoc: vi.fn(),
  Timestamp: {},
}));

const { claimCheckIn } = await import('./leaderboard');

const args = { userId: 'u1', userName: 'x', landmarkId: 'lm', landmarkName: 'LM', region: 'miami', points: 100 };

describe('claimCheckIn visit numbering', () => {
  beforeEach(() => {
    state.written = null;
  });

  it('pays full points for the first real visit after a rating-only claim', async () => {
    state.prior = [{ ratingOnly: true, visited: false, points: 0 }];
    const res = await claimCheckIn(args);
    expect(res.visitNumber).toBe(1);
    expect(res.payout).toBe(100);
    // doc id must still be unique: the rating claim already holds the first id.
    expect(state.written.id).toBe('u1_lm_2');
  });

  it('does not reuse a surviving doc id after an earlier check-in was deleted', async () => {
    // visit 1 was deleted; only u1_lm_2 remains -> next id must be _3, not _2.
    state.prior = [{ visited: true, points: 20, __id: 'u1_lm_2' }];
    await claimCheckIn(args);
    expect(state.written.id).toBe('u1_lm_3');
  });

  it('saves distance, GPS accuracy and the verification tag on a real check-in; leaves a rating-only claim untagged', async () => {
    const location = { distanceMeters: 12, gpsAccuracyMeters: 8, verification: 'unverified' };
    state.prior = [];
    await claimCheckIn({ ...args, location });
    expect(state.written).toMatchObject(location);
    state.written = null;
    await claimCheckIn({ ...args, ratingOnly: true, points: 0, location });
    expect(state.written.ratingOnly).toBe(true);
    for (const k of ['distanceMeters', 'gpsAccuracyMeters', 'verification']) expect(k in state.written).toBe(false);
  });

  it('pays nothing on real repeat visits but still logs them', async () => {
    state.prior = [{ visited: true, points: 100 }];
    const res = await claimCheckIn(args);
    expect(res.visitNumber).toBe(2);
    expect(res.payout).toBe(0);
    expect(state.written.id).toBe('u1_lm_2');
  });
});
