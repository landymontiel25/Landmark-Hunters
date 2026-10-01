import { describe, it, expect, vi } from 'vitest';

const store = new Map();
vi.mock('firebase/firestore', () => {
  const snap = (path) => ({ exists: () => store.has(path), data: () => store.get(path) });
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (ref) => snap(ref.path),
    runTransaction: vi.fn(),
    serverTimestamp: () => 0,
    arrayUnion: (x) => x,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    addDoc: vi.fn(),
  };
});
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('./firebase', () => ({ db: {}, storage: {} }));

import { submitReview } from './reviews';

const landmark = { id: 'lm1', name: 'Cafe', region: 'r', categories: [] };

describe('review photo cap', () => {
  it('refuses to append past 3 photos in total, with a clear message', async () => {
    store.set('checkins/u1_lm1', {});
    store.set('reviews/u1_lm1', { photoURLs: ['a', 'b'] });
    const f = (n) => new File(['x'], `${n}.jpg`, { type: 'image/jpeg' });
    await expect(
      submitReview({ userId: 'u1', userName: 'U', landmark, rating: { stars: 5 }, photoFiles: [f(1), f(2)] })
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('up to 3 photos') });
  });
});
