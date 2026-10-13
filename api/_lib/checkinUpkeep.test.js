import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { backfillRegionStats, scrubCheckinLocation, scrubLeaderboardCheckinIds } = await import('./checkinUpkeep.js');

describe('scrubCheckinLocation', () => {
  it('removes legacy location numbers and presence v1 distance and accuracy, keeping the rest', async () => {
    const db = fakeDb({
      'checkins/a': { userId: 'a', distanceMeters: 12, gpsAccuracyMeters: 8, points: 0 },
      'checkins/b': { userId: 'b', presence: { verified: false, reason: 'too-far', distanceMeters: 140, accuracyMeters: 9, version: 1 } },
      'checkins/c': { userId: 'c', presence: { verified: true, version: 2 } },
      'checkins/d': { userId: 'd', gpsAccuracyMeters: 20 },
    });
    expect(await scrubCheckinLocation(db)).toBe(3);
    expect(db.docs['checkins/d']).toEqual({ userId: 'd' });
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

describe('backfillRegionStats', () => {
  const ds = {
    truncated: [],
    checkins: [
      { userId: 'a', region: 'miami', landmarkId: 'bay', visited: true },
      { userId: 'b', region: 'coral-gables', landmarkId: 'bay', points: 100 },
      { userId: 'c', region: 'miami', landmarkId: 'bay', ratingOnly: true },
      { userId: 'd', region: 'miami', landmarkId: 'pier', visited: false },
      { userId: 'e', region: 'miami', landmarkId: 'park', visited: true },
      { userId: 'f', region: 'philly', landmarkId: 'bell', visited: true },
    ],
  };
  it('counts real visits under the region and its old ids, keeps a larger bump, skips backfilled regions', async () => {
    const db = fakeDb({
      'region_stats/miami': { counts: { park: 4 }, backfilled: false },
      'region_stats/philly': { counts: { bell: 9 }, backfilled: true },
    });
    expect(await backfillRegionStats(db, ds)).toBe(1);
    expect(db.docs['region_stats/miami'].counts).toEqual({ bay: 2, park: 4 });
    expect(db.docs['region_stats/miami'].backfilled).toBe(true);
    expect(db.docs['region_stats/philly'].counts).toEqual({ bell: 9 });
  });
  it('skips the night when the check-in load was cut short', async () => {
    const db = fakeDb({});
    expect(await backfillRegionStats(db, { ...ds, truncated: ['checkins'] })).toBe(0);
    expect(db.docs['region_stats/miami']).toBeUndefined();
  });
});
