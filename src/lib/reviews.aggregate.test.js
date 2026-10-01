import { describe, it, expect, vi } from 'vitest';

// A fake Firestore: docs live in `store`, transactions buffer their writes and
// commit them together, checking firestore.rules' reviews + landmark_ratings
// rules (reviewTierOk / ratingDeltaOk) against the before/after state the way
// the real rules do.
const store = new Map();
const key = (ref) => ref.path;
const TIER_STARS = { 'highly-recommend': 5, 'worth-trying': 3, 'probably-skip': 1 };
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const starsOf = (d) => (d ? d.stars || 0 : 0);

function checkRules(before, after) {
  for (const [path, next] of after) {
    if (path.startsWith('reviews/') && before.get(path) !== next && next) {
      // reviewTierOk: a tier is required and stars is what it maps to.
      if (TIER_STARS[next.ratingTier] === undefined || starsOf(next) !== TIER_STARS[next.ratingTier]) throw denied();
    }
    if (path.startsWith('landmark_ratings/')) {
      const lm = path.split('/')[1];
      const reviewPath = [...new Set([...before.keys(), ...after.keys()])].find(
        (k) => k.startsWith('reviews/u') && k.endsWith(`_${lm}`)
      );
      const b = starsOf(before.get(reviewPath));
      const a = starsOf(after.get(reviewPath));
      const prevAgg = before.get(path) || {};
      const countDelta = (next.count ?? 0) - (prevAgg.count || 0);
      const sumDelta = (next.sum ?? 0) - (prevAgg.sum || 0);
      const okCount = countDelta === (a > 0 ? 1 : 0) - (b > 0 ? 1 : 0);
      const okSum = a > 0 ? sumDelta === a - b : sumDelta <= 0 && sumDelta >= -b;
      if (!okCount || !okSum) throw denied();
    }
  }
}

vi.mock('firebase/firestore', () => {
  const snap = (path) => ({ exists: () => store.has(path), data: () => store.get(path) });
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (ref) => snap(ref.path),
    runTransaction: async (_db, fn) => {
      const writes = new Map(); // path -> doc | null (delete)
      const view = () => new Map([...store, ...[...writes].filter(([, v]) => v)]);
      const result = await fn({
        get: async (ref) => snap(key(ref)),
        set: (ref, data, opts) => {
          if (globalThis.__failReviewWrite && ref.path.startsWith('reviews/')) {
            throw Object.assign(new Error('offline'), { code: 'unavailable' });
          }
          const base = writes.has(key(ref)) ? writes.get(key(ref)) : store.get(key(ref));
          writes.set(key(ref), opts?.merge ? { ...(base || {}), ...data } : data);
        },
        delete: (ref) => writes.set(key(ref), null),
      });
      const after = view();
      for (const [p, v] of writes) if (!v) after.delete(p);
      checkRules(new Map(store), after);
      for (const [p, v] of writes) {
        if (v) store.set(p, v);
        else store.delete(p);
      }
      return result;
    },
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

import { submitReview, deleteMyReview, saveMyComment, appendLoveNote } from './reviews';

const landmark = { id: 'lm1', name: 'Cafe', region: 'r', categories: ['food'] };

describe('landmark_ratings aggregate vs comment-only review docs', () => {
  it('counts a rating given after a comment-only doc exists', async () => {
    store.clear();
    // Comment saved before any rating (saveMyComment): no stars on the doc.
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'nice' });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    const agg = store.get('landmark_ratings/lm1');
    expect(agg.count).toBe(1);
    expect(agg.avg).toBe(5);
  });

  it('keeps the comment and love notes when rating over a comment-only doc (it was never counted, so the count goes +1)', async () => {
    store.clear();
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'nice', loveNotes: ['the view'] });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    const r = store.get('reviews/u1_lm1');
    expect(r.stars).toBe(5);
    expect(r.comment).toBe('nice');
    expect(r.loveNotes).toEqual(['the view']);
    expect(store.get('landmark_ratings/lm1').count).toBe(1);
  });

  it('refuses a review with no tier and writes nothing (every review carries a tier)', async () => {
    store.clear();
    const original = { userId: 'u1', landmarkId: 'lm1', comment: 'nice' };
    store.set('reviews/u1_lm1', original);
    for (const rating of [undefined, {}, { comment: 'only a comment' }, { stars: 5 }, { tier: 'bogus' }]) {
      await expect(submitReview({ userId: 'u1', userName: 'u', landmark, rating })).rejects.toMatchObject({
        userMessage: expect.stringContaining('Pick how it was'),
      });
    }
    expect(store.get('reviews/u1_lm1')).toEqual(original);
    expect(store.has('landmark_ratings/lm1')).toBe(false);
  });

  it('saves a rating with no check-in at all', async () => {
    store.clear();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'worth-trying', comment: 'ok' } });
    expect(store.get('reviews/u1_lm1')).toMatchObject({ ratingTier: 'worth-trying', stars: 3, comment: 'ok' });
    expect(store.get('landmark_ratings/lm1')).toMatchObject({ count: 1, sum: 3 });
    expect([...store.keys()].some((k) => k.startsWith('checkins/'))).toBe(false);
  });

  it('a later check-in rating replaces the earlier rating-only one without double counting', async () => {
    store.clear();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'probably-skip' } });
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend', comment: 'Actually great' } });
    expect(store.get('reviews/u1_lm1')).toMatchObject({ ratingTier: 'highly-recommend', stars: 5, comment: 'Actually great' });
    expect(store.get('landmark_ratings/lm1')).toMatchObject({ count: 1, sum: 5 });
  });

  it('the fake rules reject a stale-aggregate bump that does not match the review (tamper check)', async () => {
    store.clear();
    store.set('landmark_ratings/lm1', { sum: 5, count: 1, avg: 5 });
    // Count goes up with no review of ours changing: denied.
    const { runTransaction, doc } = await import('firebase/firestore');
    await expect(
      runTransaction({}, async (tx) => {
        tx.set(doc({}, 'landmark_ratings', 'lm1'), { landmarkId: 'lm1', sum: 10, count: 2, avg: 5 }, { merge: true });
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
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

  it('a double tap over a comment-only doc counts the rating once', async () => {
    store.clear();
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'nice' });
    const args = { userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } };
    await Promise.all([submitReview(args), submitReview(args)]);
    expect(store.get('landmark_ratings/lm1').count).toBe(1);
    expect(store.get('reviews/u1_lm1').comment).toBe('nice');
  });
});

describe('comments always ride with a tier', () => {
  it('refuses a comment on a place with no tier on file unless a tier comes with it', async () => {
    store.clear();
    await expect(saveMyComment({ userId: 'u1', landmark, comment: 'just words' })).rejects.toMatchObject({
      userMessage: expect.stringContaining('to save a comment'),
    });
    expect(store.has('reviews/u1_lm1')).toBe(false);
  });

  it('saves a comment together with the picked tier, counting it once in the aggregate', async () => {
    store.clear();
    // An old comment-only doc (never counted) gets its tier now.
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'old', categories: ['food'] });
    await saveMyComment({ userId: 'u1', userName: 'u', landmark, comment: 'new words', tier: 'worth-trying' });
    expect(store.get('reviews/u1_lm1')).toMatchObject({ ratingTier: 'worth-trying', stars: 3, comment: 'new words' });
    expect(store.get('landmark_ratings/lm1')).toMatchObject({ count: 1, sum: 3 });
  });

  it('only changes the text when the review already has a tier', async () => {
    store.clear();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend', comment: 'a' } });
    await saveMyComment({ userId: 'u1', landmark, comment: 'b', tier: 'probably-skip' });
    expect(store.get('reviews/u1_lm1')).toMatchObject({ ratingTier: 'highly-recommend', stars: 5, comment: 'b' });
    expect(store.get('landmark_ratings/lm1')).toMatchObject({ count: 1, sum: 5 });
  });

  it('keeps categories on a comment-only edit that does not know them', async () => {
    store.clear();
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'old', categories: ['food'] });
    await saveMyComment({ userId: 'u1', userName: 'u', landmark: { id: 'lm1', name: 'Cafe', region: 'r' }, comment: 'x', tier: 'probably-skip' });
    expect(store.get('reviews/u1_lm1').categories).toEqual(['food']);
  });

  it('does not create a tier-less review for a love note', async () => {
    store.clear();
    expect(await appendLoveNote('u1', 'lm1', landmark, 'the view')).toBe(false);
    expect(store.has('reviews/u1_lm1')).toBe(false);
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', comment: 'legacy' });
    expect(await appendLoveNote('u1', 'lm1', landmark, 'the view')).toBe(false);
    expect(store.get('reviews/u1_lm1').loveNotes).toBeUndefined();
  });

  it('adds a love note onto a rated review', async () => {
    store.clear();
    await submitReview({ userId: 'u1', userName: 'u', landmark, rating: { tier: 'highly-recommend' } });
    expect(await appendLoveNote('u1', 'lm1', landmark, 'the view')).toBe(true);
    expect(store.get('reviews/u1_lm1')).toMatchObject({ ratingTier: 'highly-recommend', loveNotes: 'the view' });
  });
});
