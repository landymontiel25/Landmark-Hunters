import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { reputationBoard } = await import('./reputation-board.js');

describe('reputationBoard', () => {
  it('ranks by reputation, shows names and levels only, skips blocks and deleted accounts', async () => {
    const db = fakeDb({
      'reputation_scores/a': { byRegion: { philly: { score: 90, people: 11 } } },
      'reputation_scores/b': { byRegion: { philly: { score: 30, people: 4 } } },
      'reputation_scores/c': { byRegion: { philly: { score: 60, people: 2 } } },
      'reputation_scores/x': { byRegion: { philly: { score: 99, people: 20 } } },
      'reputation_scores/gone': { byRegion: { philly: { score: 70, people: 9 } } },
      'reputation_scores/m': { byRegion: { miami: { score: 500, people: 30 } } },
      'reputation/a': { levels: { philly: 'Trusted' } },
      'reputation/b': { levels: { philly: 'Local' } },
      'users/a': { username: 'ana' },
      'users/b': { username: 'bo' },
      'users/c': { displayName: 'Cy' },
      'users/x': { username: 'xi' },
      'users/m': { username: 'mo' },
      'blocks/x_me': { blockerUid: 'x', blockedUid: 'me' },
    });
    const board = await reputationBoard(db, 'me', 'philly');
    expect(board).toEqual([
      { uid: 'a', name: 'ana', level: 'Trusted' },
      { uid: 'c', name: 'Explorer', level: null },
      { uid: 'b', name: 'bo', level: 'Local' },
    ]);
    expect(JSON.stringify(board)).not.toContain('score');
  });
});
