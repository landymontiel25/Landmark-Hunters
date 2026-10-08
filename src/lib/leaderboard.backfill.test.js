import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({ docs: [], commits: [] }));

vi.mock('./firebase', () => ({ db: {}, storage: null }));
vi.mock('./friends', () => ({ getUserProfile: vi.fn() }));
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig()),
  collection: vi.fn((db, name) => name),
  query: vi.fn((c) => c),
  where: vi.fn(),
  getDocs: async (c) => ({ docs: c === 'checkins' ? state.docs : [] }),
  writeBatch: () => {
    const ops = [];
    return {
      update: (ref) => ops.push(ref),
      commit: async () => {
        if (ops.length > 500) throw new Error('too many writes');
        state.commits.push(ops.length);
      },
    };
  },
}));

import { backfillUserName } from './leaderboard';

describe('backfillUserName', () => {
  it('splits more than 500 updates into several batches and skips docs already renamed', async () => {
    state.docs = Array.from({ length: 1001 }, (_, i) => ({ ref: `c${i}`, data: () => ({ userName: i === 0 ? 'new' : 'old' }) }));
    await backfillUserName('u1', 'new');
    expect(state.commits.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...state.commits)).toBeLessThanOrEqual(500);
  });
});
