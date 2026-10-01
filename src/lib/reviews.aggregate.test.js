import { describe, it, expect, vi } from 'vitest';

// A fake Firestore: docs live in `store`, transactions read/write it directly.
const store = new Map();
const key = (ref) => ref.path;
vi.mock('firebase/firestore', () => {
  const snap = (path) => ({ exists: () => store.has(path), data: () => store.get(path) });
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (ref) => snap(ref.path),
    runTransaction: async (_db, fn) =>
      fn({
        get: async (ref) => snap(key(ref)),
        set: (ref, data, opts) => store.set(key(ref), opts?.merge ? { ...(store.get(key(ref)) || {}), ...data } : data),
        delete: (ref) => store.delete(key(ref)),
      }),
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
vi.mock('./firebase', () => ({ db: {}, storage: null }));

import { submitReview, deleteMyReview } from './reviews';

const landmark = { id: 'lm1', name: 'Cafe', region: 'r', categories: ['food'] };

describe('landmark_ratings aggregate vs comment-only review docs', () => {
  it('counts a rating given after a comment-only doc exists', async () => {
    store.clear();
    store.set('checkins/u1_lm1', { landmarkId: 'lm1' });
    // Comment saved before any rating (saveMyComment): no stars on the doc.
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'nice' });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    const agg = store.get('landmark_ratings/lm1');
    expect(agg.count).toBe(1);
    expect(agg.avg).toBe(5);
  });

  it('deleting a comment-only doc leaves the aggregate alone', async () => {
    store.clear();
    store.set('landmark_ratings/lm1', { sum: 5, count: 1, avg: 5 });
    store.set('reviews/u2_lm1', { userId: 'u2', landmarkId: 'lm1', comment: 'hi' });
    await deleteMyReview('u2', 'lm1');
    expect(store.get('landmark_ratings/lm1').count).toBe(1);
    expect(store.has('reviews/u2_lm1')).toBe(false);
  });
});

describe('editing and deleting a rating', () => {
  const seed = () => {
    store.clear();
    store.set('checkins/u1_lm1', { landmarkId: 'lm1' });
    store.set('users/u1', {});
  };

  it('does not drift tagScores/tagCounts when re-saving the same rating', async () => {
    seed();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend', comment: 'a' } });
    const first = JSON.parse(JSON.stringify(store.get('users/u1')));
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend', comment: 'b' } });
    expect(store.get('users/u1').tagScores).toEqual(first.tagScores);
    expect(store.get('users/u1').tagCounts).toEqual(first.tagCounts);
  });

  it('swaps the old tier for the new one on edit', async () => {
    seed();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'probably-skip' } });
    const u = store.get('users/u1');
    expect(u.tagCounts.r.food).toBe(1);
    expect(u.tagScores.r.food).toBe(-15);
  });

  it('rolls tagScores back when the review is deleted', async () => {
    seed();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    await deleteMyReview('u1', 'lm1');
    const u = store.get('users/u1');
    expect(u.tagCounts.r.food).toBe(0);
    expect(u.tagScores.r.food).toBe(0);
  });

  it('keeps the saved comment when the caller sends none', async () => {
    seed();
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'great', stars: 3, ratingTier: 'worth-trying' });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    expect(store.get('reviews/u1_lm1').comment).toBe('great');
  });
});
