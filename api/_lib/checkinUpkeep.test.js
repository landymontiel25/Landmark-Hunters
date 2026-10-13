import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { scrubCheckinLocation, scrubLeaderboardCheckinIds } = await import('./checkinUpkeep.js');

describe('scrubCheckinLocation', () => {
  it('removes legacy location numbers and presence v1 distance and accuracy, keeping the rest', async () => {
    const db = fakeDb({
      'checkins/a': { userId: 'a', distanceMeters: 12, gpsAccuracyMeters: 8, points: 0 },
      'checkins/b': { userId: 'b', presence: { verified: false, reason: 'too-far', distanceMeters: 140, accuracyMeters: 9, version: 1 } },
      'checkins/c': { userId: 'c', presence: { verified: true, version: 2 } },
    });
    expect(await scrubCheckinLocation(db)).toBe(2);
    expect(db.docs['checkins/a']).toEqual({ userId: 'a', points: 0 });
    expect(db.docs['checkins/b'].presence).toEqual({ verified: false, reason: 'too-far', version: 2 });
  });
});

describe('scrubLeaderboardCheckinIds', () => {
  it('takes lastCheckinId off public leaderboard entries, nothing else', async () => {
    const db = fakeDb({
      'leaderboard_entries/weekly_2026-W41_a': { userId: 'a', points: 100, lastCheckinId: 'a_bell' },
      'leaderboard_entries/weekly_2026-W41_b': { userId: 'b', points: 50 },
    });
    expect(await scrubLeaderboardCheckinIds(db)).toBe(1);
    expect(db.docs['leaderboard_entries/weekly_2026-W41_a']).toEqual({ userId: 'a', points: 100 });
  });
});
