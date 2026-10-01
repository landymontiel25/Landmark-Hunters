import { describe, it, expect, vi } from 'vitest';

const state = { base: null, all: [] };

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
  getDoc: async () => ({ exists: () => !!state.base, id: 'u1_lm', data: () => state.base }),
  getDocs: async () => ({ docs: state.all.map((x) => ({ id: x.__id, data: () => x })) }),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'ts',
  increment: (n) => n,
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
  onSnapshot: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  updateDoc: vi.fn(),
  Timestamp: {},
}));

const { getMyCheckin } = await import('./leaderboard');

describe('getMyCheckin', () => {
  it('returns null with no check-in doc', async () => {
    state.base = null;
    expect(await getMyCheckin('u1', 'lm')).toBeNull();
  });

  it('returns a real first check-in as is', async () => {
    state.base = { visited: true, ratingOnly: false, createdAt: { seconds: 100 } };
    const c = await getMyCheckin('u1', 'lm');
    expect(c.createdAt.seconds).toBe(100);
    expect(c.visitDocId).toBeUndefined();
  });

  it('shows the first real visit date when the first doc is a Rate a Landmark claim', async () => {
    state.base = { visited: false, ratingOnly: true, createdAt: { seconds: 100 }, photoURLs: ['a'] };
    state.all = [
      { __id: 'u1_lm', visited: false, ratingOnly: true, createdAt: { seconds: 100 } },
      { __id: 'u1_lm_3', visited: true, createdAt: { seconds: 900 } },
      { __id: 'u1_lm_2', visited: true, createdAt: { seconds: 500 } },
    ];
    const c = await getMyCheckin('u1', 'lm');
    expect(c.createdAt.seconds).toBe(500);
    expect(c.visitDocId).toBe('u1_lm_2');
    expect(c.photoURLs).toEqual(['a']);
  });

  it('keeps the rating claim date when there is no real visit yet', async () => {
    state.base = { visited: false, ratingOnly: true, createdAt: { seconds: 100 } };
    state.all = [{ __id: 'u1_lm', visited: false, ratingOnly: true, createdAt: { seconds: 100 } }];
    expect((await getMyCheckin('u1', 'lm')).createdAt.seconds).toBe(100);
  });
});
