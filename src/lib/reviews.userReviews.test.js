import { describe, it, expect, vi, beforeEach } from 'vitest';

// firestore.rules (reviews list): a query for SOMEONE ELSE's reviews is only
// accepted when it constrains hidden == false (and userId == them, as a
// friend). A bare where('userId', '==', friend) is rejected whole.
const calls = [];
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  collection: (_db, name) => ({ name }),
  where: (field, op, value) => ({ field, op, value }),
  query: (c, ...constraints) => ({ c, constraints }),
  getDocs: async (q) => {
    calls.push(q.constraints);
    return { docs: [] };
  },
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  setDoc: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  addDoc: vi.fn(),
  arrayUnion: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('./firebase', () => ({ db: {}, storage: null }));

import { getUserReviews } from './reviews';

beforeEach(() => {
  calls.length = 0;
});

describe('getUserReviews', () => {
  it("adds hidden == false when reading another user's reviews", async () => {
    await getUserReviews('friend1', { other: true });
    expect(calls[0]).toEqual([
      { field: 'userId', op: '==', value: 'friend1' },
      { field: 'hidden', op: '==', value: false },
    ]);
  });

  it('keeps your own reviews unfiltered (reported-hidden ones still count)', async () => {
    await getUserReviews('me');
    expect(calls[0]).toEqual([{ field: 'userId', op: '==', value: 'me' }]);
  });
});
