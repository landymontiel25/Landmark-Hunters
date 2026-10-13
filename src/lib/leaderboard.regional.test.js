import { describe, it, expect, vi } from 'vitest';
import { regionalBoard } from '../../api/regional-leaderboard.js';

vi.mock('./firebase', () => ({ db: {}, storage: null }));
vi.mock('./friends', () => ({ getUserProfile: vi.fn() }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));

import { getRegionalLeaderboard } from './leaderboard';

describe('regional leaderboard (added up by the server since Phase 2)', () => {
  it('sums this period\'s points per person and gives every row an id', () => {
    const now = Date.now();
    const board = regionalBoard(
      [
        { userId: 'a', userName: 'A', points: 100, createdAt: now },
        { userId: 'b', userName: 'B', points: 0, createdAt: now },
        { userId: 'a', userName: 'A', points: 0, createdAt: now },
        { userId: 'c', userName: 'C', points: 100, createdAt: now - 400 * 864e5 },
      ],
      { period: 'yearly', nowMs: now }
    );
    expect(board.map((e) => [e.id, e.points])).toEqual([
      ['a', 100],
      ['b', 0],
    ]);
    expect(Object.keys(board[0]).sort()).toEqual(['id', 'points', 'userId', 'userName']);
  });
  it('the app asks the server with the region, period and its time zone', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [{ id: 'a', userId: 'a', userName: 'A', points: 5 }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getRegionalLeaderboard('weekly', 'miami')).toEqual([{ id: 'a', userId: 'a', userName: 'A', points: 5 }]);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/regional-leaderboard\?region=miami&period=weekly&tz=-?\d+$/);
    vi.unstubAllGlobals();
  });
});
