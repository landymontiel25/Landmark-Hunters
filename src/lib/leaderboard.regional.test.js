import { describe, it, expect, vi } from 'vitest';

const rows = vi.hoisted(() => []);

vi.mock('./firebase', () => ({ db: {}, storage: null }));
vi.mock('./friends', () => ({ getUserProfile: vi.fn() }));
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig()),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: async () => ({ docs: rows.map((r) => ({ data: () => r })) }),
}));

import { getRegionalLeaderboard } from './leaderboard';

describe('getRegionalLeaderboard', () => {
  it('gives every row an id, so the board rows have keys', async () => {
    const sec = Math.floor(Date.now() / 1000);
    rows.push(
      { userId: 'a', userName: 'A', points: 100, createdAt: { seconds: sec } },
      { userId: 'b', userName: 'B', points: 0, createdAt: { seconds: sec } },
      { userId: 'a', userName: 'A', points: 0, createdAt: { seconds: sec } }
    );
    const board = await getRegionalLeaderboard('yearly', 'miami');
    expect(board.map((e) => [e.id, e.points])).toEqual([
      ['a', 100],
      ['b', 0],
    ]);
  });
});
