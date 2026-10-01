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
        set: (ref, data, opts) => {
          // firestore.rules (ratingDeltaOk): landmark_ratings.count may only go
          // up by one while this user's review doc for it does not exist yet.
          if (ref.path.startsWith('landmark_ratings/')) {
            const cur = store.get(ref.path)?.count || 0;
            const review = [...store.keys()].find((k) => k.startsWith('reviews/u') && k.endsWith(`_${ref.path.split('/')[1]}`));
            if ((data.count ?? cur) - cur === 1 && review) {
              const err = new Error('Missing or insufficient permissions.');
              err.code = 'permission-denied';
              throw err;
            }
          }
          if (globalThis.__failReviewWrite && ref.path.startsWith('reviews/')) {
            throw Object.assign(new Error('offline'), { code: 'unavailable' });
          }
          store.set(key(ref), opts?.merge ? { ...(store.get(key(ref)) || {}), ...data } : data);
        },
        delete: (ref) => store.delete(key(ref)),
      }),
    deleteDoc: async (ref) => {
      store.delete(ref.path);
    },
    setDoc: async (ref, data) => {
      store.set(ref.path, data);
    },
    serverTimestamp: () => 0,
    arrayUnion: (x) => x,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
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

  it('keeps the comment and love notes when rating over a comment-only doc (rules: +1 only if the doc is new)', async () => {
    store.clear();
    store.set('checkins/u1_lm1', { landmarkId: 'lm1' });
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'nice', loveNotes: ['the view'] });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    const r = store.get('reviews/u1_lm1');
    expect(r.stars).toBe(5);
    expect(r.comment).toBe('nice');
    expect(r.loveNotes).toEqual(['the view']);
    expect(store.get('landmark_ratings/lm1').count).toBe(1);
  });

  it('puts a comment-only doc back if the rating cannot be saved', async () => {
    store.clear();
    store.set('checkins/u1_lm1', { landmarkId: 'lm1' });
    const original = { userId: 'u1', landmarkId: 'lm1', comment: 'nice' };
    store.set('reviews/u1_lm1', original);
    globalThis.__failReviewWrite = true;
    try {
      await expect(
        submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } })
      ).rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      globalThis.__failReviewWrite = false;
    }
    expect(store.get('reviews/u1_lm1')).toEqual(original);
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
