import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts', increment: (n) => n } }));

const { cleanUserName, awardLeaderboardPointsServer } = await import('./leaderboardPoints.js');

describe('cleanUserName', () => {
  it('keeps a normal name, trimmed', () => {
    expect(cleanUserName('  Ana  ')).toBe('Ana');
  });
  it('falls back for non-strings, empty and oversized names', () => {
    expect(cleanUserName({ evil: 1 })).toBe('A traveler');
    expect(cleanUserName(undefined)).toBe('A traveler');
    expect(cleanUserName('   ')).toBe('A traveler');
    expect(cleanUserName('x'.repeat(201))).toBe('A traveler');
    expect(cleanUserName('x'.repeat(200))).toBe('x'.repeat(200));
  });
  it('never writes an object name to leaderboard entries', async () => {
    const sets = [];
    const db = {
      collection: () => ({ doc: (id) => id }),
      batch: () => ({ set: (_r, data) => sets.push(data), commit: async () => {} }),
    };
    await awardLeaderboardPointsServer(db, 'u1', { toString: 1 }, 5, '2026-9-7');
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.userName === 'A traveler')).toBe(true);
  });
});
