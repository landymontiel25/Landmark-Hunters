import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('../../src/data/regions.js', () => ({ canonicalRegionId: (r) => (r === 'coralgables' ? 'miami' : r) }));
const { backfillRegionStats, scrubCheckinLocation } = await import('./checkinUpkeep.js');

describe('backfillRegionStats', () => {
  it('builds counts for regions not yet backfilled from real visits, and leaves backfilled ones alone', async () => {
    const db = fakeDb({ 'region_stats/philly': { counts: { bell: 9 }, backfilled: true } });
    const ds = {
      checkins: [
        { region: 'miami', landmarkId: 'a' },
        { region: 'coralgables', landmarkId: 'a' },
        { region: 'miami', landmarkId: 'b', ratingOnly: true },
        { region: 'philly', landmarkId: 'bell' },
      ],
    };
    expect(await backfillRegionStats(db, ds)).toBe(1);
    expect(db.docs['region_stats/miami']).toMatchObject({ counts: { a: 2 }, backfilled: true });
    expect(db.docs['region_stats/philly'].counts).toEqual({ bell: 9 });
    expect(await backfillRegionStats(fakeDb(), { ...ds, truncated: ['checkins'] })).toBe(0);
  });
});

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
