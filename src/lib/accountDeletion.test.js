import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates = [];
const deletedFiles = [];
vi.mock('firebase/firestore', () => {
  const docsFor = (col) =>
    col === 'checkins'
      ? [
          { ref: { path: 'checkins/u1_a' }, data: () => ({ photoURL: 'legacy', photoURLs: ['g1', 'g2'] }) },
          { ref: { path: 'checkins/u1_b' }, data: () => ({}) },
        ]
      : [];
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    collection: (_db, name) => ({ name }),
    query: (c) => c,
    where: vi.fn(),
    getDoc: async () => ({ exists: () => false }),
    getDocs: async (c) => ({ docs: docsFor(c.name) }),
    updateDoc: async (ref, patch) => {
      updates.push([ref.path, patch]);
    },
    deleteDoc: vi.fn(async () => {}),
  };
});
vi.mock('firebase/storage', () => ({
  ref: (_s, url) => ({ url }),
  deleteObject: async (r) => {
    deletedFiles.push(r.url);
  },
}));
vi.mock('./firebase', () => ({ db: {}, storage: {} }));
vi.mock('./reviews', () => ({ deleteMyReview: vi.fn() }));

import { deleteAccountData } from './accountDeletion';

beforeEach(() => {
  updates.length = 0;
  deletedFiles.length = 0;
});

describe('deleteAccountData check-in scrub', () => {
  it('clears the photo gallery and its files, using only fields firestore.rules lets an owner change', async () => {
    await deleteAccountData('u1');
    const [, patchA] = updates.find(([p]) => p === 'checkins/u1_a');
    expect(patchA).toEqual({ userName: 'Deleted User', photoURL: null, photoURLs: [] });
    // checkins update rule: affectedKeys().hasOnly(['photoURL', 'photoURLs', 'userName'])
    for (const [, patch] of updates) {
      expect(Object.keys(patch).every((k) => ['photoURL', 'photoURLs', 'userName'].includes(k))).toBe(true);
    }
    expect(deletedFiles).toEqual(expect.arrayContaining(['legacy', 'g1', 'g2']));
    const [, patchB] = updates.find(([p]) => p === 'checkins/u1_b');
    expect(patchB).toEqual({ userName: 'Deleted User', photoURL: null });
  });
});
