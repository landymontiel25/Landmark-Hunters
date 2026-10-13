import { describe, it, expect, vi } from 'vitest';
import { regionalBoard, visibleOwners } from '../../api/regional-leaderboard.js';
import { fakeDb } from '../../api/_lib/fakeDb.testutil.js';

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
        { userId: 'd', userName: 'D', points: 100, createdAt: now },
      ],
      { period: 'yearly', nowMs: now, canSee: (u) => u !== 'd' }
    );
    // Nobody with 0 points (it would only say "was here"), nobody this
    // viewer can't see.
    expect(board.map((e) => [e.id, e.points])).toEqual([['a', 100]]);
    expect(Object.keys(board[0]).sort()).toEqual(['id', 'points', 'userId', 'userName']);
  });
  it('the app asks the server with the region, period and its time zone', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [{ id: 'a', userId: 'a', userName: 'A', points: 5 }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getRegionalLeaderboard('weekly', 'miami')).toEqual([{ id: 'a', userId: 'a', userName: 'A', points: 5 }]);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/regional-leaderboard\?region=miami&period=weekly&tz=-?\d+(&zone=[^&]+)?$/);
    vi.unstubAllGlobals();
  });
});

describe('visibleOwners', () => {
  it('the viewer, friends and public profiles, minus a block either way', async () => {
    const db = fakeDb({
      'users/pub': { public: true },
      'users/priv': { public: false },
      'users/pubBlocked': { public: true },
      'friend_edges/me_friend': { owner: 'me', friend: 'friend' },
      'blocks/pubBlocked_me': { blockerUid: 'pubBlocked', blockedUid: 'me' },
    });
    const out = await visibleOwners(db, 'me', ['me', 'pub', 'priv', 'friend', 'pubBlocked', 'ghost']);
    expect([...out].sort()).toEqual(['friend', 'me', 'pub']);
  });
});
