// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The save itself fails the way the live one did (rules refused it) until
// `fixed` flips, so this checks the wrapper every screen uses: retried,
// logged, queued, then sent by the flush once it can save.
const state = vi.hoisted(() => ({ fixed: false, tries: 0, logged: [] }));
vi.mock('./firebase', () => ({ db: {}, storage: null }));
vi.mock('./ratingQueue', async (orig) => {
  const real = await orig();
  return {
    ...real,
    withRetries: (run, opts) => real.withRetries(run, { ...opts, wait: () => Promise.resolve() }),
    logSaveError: (x) => state.logged.push(x),
  };
});
vi.mock('firebase/firestore', () => ({
  doc: (...p) => p.slice(1).join('/'),
  collection: () => 'c',
  runTransaction: async () => {
    state.tries++;
    if (!state.fixed) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  },
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ docs: [] }),
  serverTimestamp: () => 'now',
  query: () => null, where: () => null, orderBy: () => null, limit: () => null,
  setDoc: async () => {}, updateDoc: async () => {}, deleteDoc: async () => {}, arrayUnion: () => null,
}));
vi.mock('./tasteScoreStore', () => ({ scheduleTasteRecompute: () => {} }));

const { submitReview, flushQueuedRatings } = await import('./reviews.js');
const { queuedRatings } = await import('./ratingQueue.js');

const landmark = { id: 'abaco-beach-resort', name: 'Abaco Beach Resort', region: 'abacos', categories: ['food'] };
const args = { userId: 'me', userName: 'me', landmark, rating: { tier: 'highly-recommend', wouldReturn: 'yes', comment: 'Lovely' } };

beforeEach(() => {
  localStorage.clear();
  Object.assign(state, { fixed: false, tries: 0, logged: [] });
});

describe('submitReview when the save keeps failing', () => {
  it('tries 4 times, logs each real error, and keeps the rating on the device', async () => {
    const res = await submitReview(args, { source: 'checkin' });
    expect(res).toMatchObject({ queued: true, photosDropped: false });
    expect(state.tries).toBe(4);
    expect(state.logged.map((l) => [l.attempt, l.error.code, l.source])).toEqual([0, 1, 2, 3].map((a) => [a, 'permission-denied', 'checkin']));
    expect(queuedRatings('me').map((q) => q.rating.tier)).toEqual(['highly-recommend']);
  });

  it('the flush saves it once it can, and empties the queue', async () => {
    await submitReview(args);
    state.fixed = true;
    await expect(flushQueuedRatings('me')).resolves.toBe(1);
    expect(queuedRatings('me')).toEqual([]);
  });

  it('a flush that still fails keeps it waiting', async () => {
    await submitReview(args);
    await expect(flushQueuedRatings('me')).resolves.toBe(0);
    expect(queuedRatings('me')).toHaveLength(1);
  });

  it('saves on the first try when nothing is wrong', async () => {
    state.fixed = true;
    const res = await submitReview(args);
    expect(res.queued).toBeUndefined();
    expect(state.tries).toBe(1);
    expect(queuedRatings('me')).toEqual([]);
  });
});
