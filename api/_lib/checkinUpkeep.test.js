import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { recountRegionStats, scrubCheckinLocation, scrubLeaderboardCheckinIds } = await import('./checkinUpkeep.js');

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

describe('recountRegionStats', () => {
  const ds = {
    truncated: [],
    checkins: [
      { userId: 'a', region: 'miami', landmarkId: 'bay', visited: true },
      { userId: 'b', region: 'coral-gables', landmarkId: 'bay', points: 100 },
      { userId: 'c', region: 'miami', landmarkId: 'bay', ratingOnly: true },
      { userId: 'd', region: 'miami', landmarkId: 'pier', visited: false },
      { userId: 'e', region: 'miami', landmarkId: 'park', visited: true },
    ],
  };
  it('overwrites each region with its real visits (old ids folded in), wiping made-up counts and junk docs', async () => {
    const db = fakeDb({
      'region_stats/miami': { counts: { park: 999 }, backfilled: true },
      'region_stats/philly': { counts: { bell: 50 }, backfilled: true },
      'region_stats/made-up': { counts: { bay: 7 } },
    });
    await recountRegionStats(db, ds);
    expect(db.docs['region_stats/miami'].counts).toEqual({ bay: 2, park: 1 });
    expect(db.docs['region_stats/philly'].counts).toEqual({});
    expect(db.docs['region_stats/made-up']).toBeUndefined();
  });
  it('skips the night when the check-in load was cut short', async () => {
    const db = fakeDb({ 'region_stats/miami': { counts: { park: 4 } } });
    expect(await recountRegionStats(db, { ...ds, truncated: ['checkins'] })).toBe(0);
    expect(db.docs['region_stats/miami'].counts).toEqual({ park: 4 });
  });
});
