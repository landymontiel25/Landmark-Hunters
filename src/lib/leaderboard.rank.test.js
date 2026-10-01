import { describe, it, expect } from 'vitest';
import { rankOf } from './leaderboard';

describe('rankOf', () => {
  const board = [{ points: 500 }, { points: 300 }, { points: 300 }, { points: 300 }, { points: 100 }];

  it('gives tied entries the same rank and skips the shared positions after them', () => {
    expect(board.map((_, i) => rankOf(board, i))).toEqual([1, 2, 2, 2, 5]);
  });

  it('returns null for a row that is not on the board', () => {
    expect(rankOf(board, -1)).toBeNull();
    expect(rankOf(board, 9)).toBeNull();
  });
});
