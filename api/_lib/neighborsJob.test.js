import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { runNeighbors } = await import('./neighborsJob.js');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const taste = (scores) => ({ tagScores: { philly: scores }, tagScoresAt: { philly: Object.fromEntries(Object.keys(scores).map((k) => [k, NOW])) } });
const tenRatings = (uid, region = 'philly') => Array.from({ length: 10 }, (_, i) => ({ userId: uid, landmarkId: `p${i}`, ratingTier: 'highly-recommend', region, ratedAt: NOW }));

describe('runNeighbors', () => {
  it('lists finders at or above the floor, per city and overall, skips blocks, removes stale docs', async () => {
    const db = fakeDb({
      'users/me': taste({ food: 80, parks: 40 }),
      'users/finder': taste({ food: 80, parks: 40 }),
      'users/other': taste({ food: -80 }),
      'users/blocker': taste({ food: 80, parks: 40 }),
      'blocks/blocker_me': { blockerUid: 'blocker', blockedUid: 'me' },
      'mapr_neighbors/gone': { global: [] },
    });
    const ds = {
      truncated: [],
      reviews: [...tenRatings('me'), ...tenRatings('finder'), ...tenRatings('other'), ...tenRatings('blocker')],
      checkins: [],
      tips: [
        { authorUid: 'finder', region: 'philly', status: 'live', hidden: false },
        { authorUid: 'other', region: 'philly', status: 'live', hidden: false },
        { authorUid: 'blocker', region: 'philly', status: 'live', hidden: false },
        { authorUid: 'held', region: 'philly', status: 'held', hidden: false },
      ],
    };
    const out = await runNeighbors(db, ds, { nowMs: NOW });
    expect(out.withNeighbors).toBeGreaterThan(0);
    const mine = db.docs['mapr_neighbors/me'];
    expect(mine.global.map((n) => n.uid)).toEqual(['finder']);
    expect(mine.byRegion.philly.map((n) => n.uid)).toEqual(['finder']);
    expect(mine.global[0].score).toBeGreaterThanOrEqual(0.6);
    expect(db.docs['mapr_neighbors/gone']).toBeUndefined();
  });
  it('skips a night with cut-short reviews or tips', async () => {
    const db = fakeDb({});
    expect(await runNeighbors(db, { truncated: ['reviews'] }, { nowMs: NOW })).toEqual({ skipped: true });
  });
});
