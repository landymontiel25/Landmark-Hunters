// @vitest-environment jsdom
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
      : col === 'pick_feedback'
      ? [
          { ref: { path: 'pick_feedback/u1_a' }, data: () => ({ userId: 'u1', landmarkId: 'a', verdict: 'yes', pickSetId: 's', pickSurface: 'chat', pickShownAt: 1 }) },
          { ref: { path: 'pick_feedback/u1_b' }, data: () => ({ userId: 'u1', landmarkId: 'b', verdict: 'no' }) },
        ]
      : col === 'users/u1/place_scores'
      ? [
          { ref: { path: 'users/u1/place_scores/a' }, data: () => ({ landmarkId: 'a', placeScore: -46, missWeight: 0.5 }) },
          { ref: { path: 'users/u1/place_scores/b' }, data: () => ({ landmarkId: 'b', placeScore: 4, missWeight: 0 }) },
        ]
      : col === 'users/u1/open_days'
      ? [
          { ref: { path: 'users/u1/open_days/2026-10-01' }, data: () => ({ userId: 'u1', date: '2026-10-01' }) },
          { ref: { path: 'users/u1/open_days/2026-10-02' }, data: () => ({ userId: 'u1', date: '2026-10-02' }) },
        ]
      : col === 'users/u1/taste_history'
      ? [
          { ref: { path: 'users/u1/taste_history/h1' }, data: () => ({ at: 1, score: 80, guesses: 20, ratingsCount: 30, version: 1 }) },
          { ref: { path: 'users/u1/taste_history/h2' }, data: () => ({ at: 2, score: null, guesses: 3, ratingsCount: 5, version: 1 }) },
        ]
      : col === 'reviews'
      ? [{ ref: { path: 'reviews/u1_a' }, data: () => ({ userId: 'u1', landmarkId: 'a', ratingTier: 'highly-recommend', pickSetId: 's', pickSurface: 'mapr-tab', pickShownAt: 1, ratedAt: 1, priorTier: 'probably-skip', priorRatedAt: 0, disagreement: { reason: 'food', comment: 'cold', at: 2, source: 'asked' } }) }]
      : col === 'recommendation_log'
        ? [
            { ref: { path: 'recommendation_log/old' }, data: () => ({ userId: 'u1', landmarkId: 'a' }) },
            {
              ref: { path: 'recommendation_log/shown' },
              data: () => ({ userId: 'u1', landmarkId: 'b', setId: 'u1-1-x', rank: 2, shownAt: 1, surface: 'chat', predicted: 'positive' }),
            },
          ]
        : col === 'custom_landmarks'
        ? [{ ref: { path: 'custom_landmarks/c1' }, data: () => ({ images: ['img1'] }) }]
        : col === 'checkins'
      ? [
          { ref: { path: 'checkins/u1_a' }, data: () => ({ photoURL: 'legacy', photoURLs: ['g1', 'g2'] }) },
          { ref: { path: 'checkins/u1_b' }, data: () => ({}) },
          { ref: { path: 'checkins/u1_c' }, data: () => ({ distanceMeters: 12, gpsAccuracyMeters: 8, verification: 'unverified' }) },
        ]
      : [];
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    collection: (_db, ...parts) => ({ name: parts.join('/') }),
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
      expect(Object.keys(patch).every((k) => ['photoURL', 'photoURLs', 'userName', 'distanceMeters', 'gpsAccuracyMeters'].includes(k))).toBe(true);
    }
    expect(deletedFiles).toEqual(expect.arrayContaining(['legacy', 'g1', 'g2']));
    const [, patchB] = updates.find(([p]) => p === 'checkins/u1_b');
    expect(patchB).toEqual({ userName: 'Deleted User', photoURL: null });
  });

  it('removes the location-derived numbers (distance, GPS accuracy) from check-ins that have them', async () => {
    await deleteAccountData('u1');
    const [, patchC] = updates.find(([p]) => p === 'checkins/u1_c');
    expect(patchC).toEqual({
      userName: 'Deleted User',
      photoURL: null,
      distanceMeters: 'DELETE_FIELD',
      gpsAccuracyMeters: 'DELETE_FIELD',
    });
    // Check-ins without them get no location keys at all.
    const [, patchB] = updates.find(([p]) => p === 'checkins/u1_b');
    expect('distanceMeters' in patchB).toBe(false);
  });
});

describe('deleteAccountData wipe coverage', () => {
  it('removes recommendation_log rows, including shown rows with setId/rank/predicted', async () => {
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['recommendation_log/old', 'recommendation_log/shown']));
  });

  it('removes pick_feedback docs and reviews that carry pick marks (the marks live inside the docs)', async () => {
    const { deleteMyReview } = await import('./reviews');
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['pick_feedback/u1_a', 'pick_feedback/u1_b']));
    expect(deleteMyReview).toHaveBeenCalledWith('u1', 'a');
  });

  it('clears the on-device copy of taps and the pending-retry queue (taps not yet sent)', async () => {
    localStorage.setItem('lh-pick-feedback:u1', JSON.stringify({ a: { landmarkId: 'a', verdict: 'yes', pickSetId: 's' } }));
    localStorage.setItem('lh-pick-feedback-pending:u1', JSON.stringify({ b: { landmarkId: 'b', verdict: 'no', pickSetId: 's' } }));
    localStorage.setItem('lh-pick-feedback-pending:u2', JSON.stringify({ c: { landmarkId: 'c', verdict: 'no' } }));
    await deleteAccountData('u1');
    expect(localStorage.getItem('lh-pick-feedback:u1')).toBeNull();
    expect(localStorage.getItem('lh-pick-feedback-pending:u1')).toBeNull();
    expect(localStorage.getItem('lh-pick-feedback-pending:u2')).not.toBeNull(); // someone else's is untouched
    localStorage.clear();
  });

  it('removes a review that carries the re-rating fields (ratedAt, priorTier, priorRatedAt, disagreement): they live inside the doc', async () => {
    const { deleteMyReview } = await import('./reviews');
    await deleteAccountData('u1');
    // the review is removed through deleteMyReview, which deletes the whole doc (and its place score ledger)
    expect(deleteMyReview).toHaveBeenCalledWith('u1', 'a');
    expect(deletedPaths).toContain('users/u1/place_scores/a');
  });

  it('removes every Mapr place score (users/{uid}/place_scores), which outlive users/{uid}', async () => {
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['users/u1/place_scores/a', 'users/u1/place_scores/b']));
    expect(deletedPaths).toContain('users/u1');
  });

  it('removes every taste score snapshot (users/{uid}/taste_history), which outlive users/{uid}', async () => {
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['users/u1/taste_history/h1', 'users/u1/taste_history/h2']));
  });

  it('removes every daily open record (users/{uid}/open_days) and the profile that holds createdAt', async () => {
    await deleteAccountData('u1');
    expect(deletedPaths).toEqual(expect.arrayContaining(['users/u1/open_days/2026-10-01', 'users/u1/open_days/2026-10-02']));
    expect(deletedPaths).toContain('users/u1'); // createdAt lives on this doc
  });

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
