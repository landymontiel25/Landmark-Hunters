import { describe, it, expect } from 'vitest';
import { countedShownPicks, computeMatchRate, gatherMatchRateInputs } from './matchRate';
import { MATCH_WEEK_MS } from './maprConstants';

const T = Date.UTC(2026, 5, 1);
const row = (o = {}) => ({ userId: 'u1', region: 'r', landmarkId: 'a', setId: 's', shownAt: T, isTest: false, ...o });

describe('countedShownPicks', () => {
  it('keeps one row per user per place per week', () => {
    const rows = [row(), row({ setId: 's2', shownAt: T + 1000 }), row({ setId: 's3', shownAt: T + MATCH_WEEK_MS - 1 })];
    expect(countedShownPicks(rows)).toHaveLength(1);
  });
  it('counts again once the week has passed, and the window restarts from that one', () => {
    const rows = [row(), row({ shownAt: T + MATCH_WEEK_MS }), row({ shownAt: T + MATCH_WEEK_MS + 1000 })];
    expect(countedShownPicks(rows).map((r) => r.shownAt)).toEqual([T, T + MATCH_WEEK_MS]);
  });
  it('separates users and places, and keeps the earliest regardless of input order', () => {
    const rows = [row({ userId: 'u2' }), row({ landmarkId: 'b' }), row({ shownAt: T + 5, setId: 'late' }), row()];
    const out = countedShownPicks(rows);
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.userId === 'u1' && r.landmarkId === 'a').setId).toBe('s');
  });
  it('ignores test rows and old build-time rows that were never shown', () => {
    const rows = [row({ isTest: true }), row({ setId: undefined }), row({ shownAt: undefined }), row({ landmarkId: 'z' })];
    expect(countedShownPicks(rows).map((r) => r.landmarkId)).toEqual(['z']);
  });
  it('reads Firestore timestamps and handles empty input', () => {
    expect(countedShownPicks([row({ shownAt: { seconds: T / 1000 } })])).toHaveLength(1);
    expect(countedShownPicks(null)).toEqual([]);
  });
});

describe('check-in ratings count the same for Just me and A group', () => {
  it('a rating row carrying a group marker is counted exactly like one without', () => {
    const shown = [{ userId: 'u', landmarkId: 'a', setId: 's', shownAt: 1, region: 'r' }];
    const base = { userId: 'u', landmarkId: 'a', ratingTier: 'highly-recommend', pickSetId: 's', updatedAt: 5 };
    const solo = gatherMatchRateInputs({ recommendationLog: shown, reviews: [{ ...base, companions: 'solo' }] });
    const group = gatherMatchRateInputs({ recommendationLog: shown, reviews: [{ ...base, companions: 'group' }] });
    expect(computeMatchRate(group).overall).toEqual(computeMatchRate(solo).overall);
    expect(computeMatchRate(group).overall.ratings.positive).toBe(1);
  });
});
