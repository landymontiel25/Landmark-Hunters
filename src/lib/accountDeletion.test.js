import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates = [];
const deletedFiles = [];
const queries = [];
const deletedPaths = [];
vi.mock('firebase/firestore', () => {
  const docsFor = (col) =>
    col === 'group_trips'
      ? [
          { ref: { path: 'group_trips/own' }, data: () => ({ ownerUid: 'u1', memberUids: ['u1', 'x'] }) },
          { ref: { path: 'group_trips/joined' }, data: () => ({ ownerUid: 'x', memberUids: ['x', 'u1'] }) },
        ]
      : col === 'custom_landmarks'
        ? [{ ref: { path: 'custom_landmarks/c1' }, data: () => ({ images: ['img1'] }) }]
        : col === 'checkins'
      ? [
          { ref: { path: 'checkins/u1_a' }, data: () => ({ photoURL: 'legacy', photoURLs: ['g1', 'g2'] }) },
          { ref: { path: 'checkins/u1_b' }, data: () => ({}) },
        ]
      : [];
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    collection: (_db, name) => ({ name }),
    query: (c) => c,
    where: (field, op, value) => {
      queries.push([field, op, value]);
    },
    deleteField: () => 'DELETE_FIELD',
    getDoc: async () => ({ exists: () => false }),
    getDocs: async (c) => ({ docs: docsFor(c.name) }),
    updateDoc: async (ref, patch) => {
      updates.push([ref.path, patch]);
    },
    deleteDoc: async (r) => {
      deletedPaths.push(r.path);
    },
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
  queries.length = 0;
  deletedPaths.length = 0;
});

describe('deleteAccountData check-in scrub', () => {
  it('clears the photo gallery and its files, using only fields firestore.rules lets an owner change', async () => {
    await deleteAccountData('u1');
    const [, patchA] = updates.find(([p]) => p === 'checkins/u1_a');
    expect(patchA).toEqual({ userName: 'Deleted User', photoURL: null, photoURLs: [] });
    // checkins update rule: affectedKeys().hasOnly(['photoURL', 'photoURLs', 'userName'])
    for (const [, patch] of updates.filter(([p]) => p.startsWith('checkins/'))) {
      expect(Object.keys(patch).every((k) => ['photoURL', 'photoURLs', 'userName'].includes(k))).toBe(true);
    }
    expect(deletedFiles).toEqual(expect.arrayContaining(['legacy', 'g1', 'g2']));
    const [, patchB] = updates.find(([p]) => p === 'checkins/u1_b');
    expect(patchB).toEqual({ userName: 'Deleted User', photoURL: null });
  });
});

describe('deleteAccountData wipe coverage', () => {
  it('queries every owned collection by its ownership field', async () => {
    await deleteAccountData('u1');
    const has = (f, o = '==') => queries.some(([qf, qo, v]) => qf === f && qo === o && v === 'u1');
    for (const f of ['userId', 'from', 'to', 'owner', 'blockerUid', 'uid', 'ownerUid', 'createdBy']) expect(has(f)).toBe(true);
    expect(has('memberIds', 'array-contains')).toBe(true);
    expect(has('memberUids', 'array-contains')).toBe(true);
  });

  it('deletes owned group trips, leaves joined ones, and deletes submitted landmarks plus images', async () => {
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['group_trips/own', 'custom_landmarks/c1', 'users/u1']));
    expect(deletedPaths).not.toContain('group_trips/joined');
    const [, patch] = updates.find(([p]) => p === 'group_trips/joined');
    expect(patch).toEqual({ memberUids: ['x'], 'memberNames.u1': 'DELETE_FIELD' });
    expect(deletedFiles).toContain('img1');
  });
});
