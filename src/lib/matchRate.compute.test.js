import { describe, it, expect } from 'vitest';
import { computeMatchRate, gatherMatchRateInputs } from './matchRate';
import { MATCH_ELIGIBLE_MIN_RATINGS, MATCH_WEIGHT_RATING, MATCH_WEIGHT_TAP } from './maprConstants';

const T = Date.UTC(2026, 5, 1);
const shown = (o = {}) => ({ userId: 'u1', region: 'r', landmarkId: 'a', setId: 's1', shownAt: T, isTest: false, ...o });
const tap = (o = {}) => ({ userId: 'u1', landmarkId: 'a', level: 'positive', pickSetId: 's1', at: T + 10, ...o });
const rating = (o = {}) => tap(o);

describe('computeMatchRate', () => {
  it('weights ratings 2 and taps 1', () => {
    expect([MATCH_WEIGHT_RATING, MATCH_WEIGHT_TAP]).toEqual([2, 1]);
    const { perUser } = computeMatchRate({
      shown: [shown(), shown({ landmarkId: 'b' })],
      taps: [tap({ landmarkId: 'b', level: 'negative' })],
      ratings: [rating({ level: 'positive' })],
    });
    const u = perUser.u1;
    expect(u.weightedPositive).toBe(2);
    expect(u.weightedTotal).toBe(3);
    expect(u.matchRate).toBeCloseTo(2 / 3);
  });

  it('counts a pick with both a tap and a rating twice (once each)', () => {
    const { perUser } = computeMatchRate({ shown: [shown()], taps: [tap()], ratings: [rating({ level: 'neutral' })] });
    expect(perUser.u1.tapCount).toBe(1);
    expect(perUser.u1.ratingCount).toBe(1);
    expect(perUser.u1.weightedTotal).toBe(3);
    expect(perUser.u1.matchRate).toBeCloseTo(1 / 3);
  });

  it('ignores a reaction before the pick was shown, but counts one at the same instant', () => {
    const { perUser } = computeMatchRate({
      shown: [shown()],
      taps: [tap({ at: T - 1 }), tap({ at: T })],
      ratings: [rating({ at: T - 5 })],
    });
    expect(perUser.u1.tapCount).toBe(1);
    expect(perUser.u1.ratingCount).toBe(0);
  });

  it('counts only reactions marked as from a pick that match a real, non-test shown row', () => {
    const { perUser, overall } = computeMatchRate({
      shown: [shown(), shown({ landmarkId: 't', setId: 'st', isTest: true })],
      taps: [
        tap({ pickSetId: undefined }), // not from a pick
        tap({ landmarkId: 't', pickSetId: 'st' }), // test row
        tap({ pickSetId: 'unknown-set' }), // never logged as shown
        tap({ level: 'weird' }),
        tap(),
      ],
    });
    expect(perUser.u1.tapCount).toBe(1);
    expect(overall.tapCount).toBe(1);
  });

  it('is null (not zero) when a user has no reactions yet', () => {
    const { perUser, overall } = computeMatchRate({ shown: [shown()] });
    expect(perUser.u1.matchRate).toBeNull();
    expect(perUser.u1.shown).toBe(1);
    expect(overall.matchRate).toBeNull();
    expect(computeMatchRate().overall.matchRate).toBeNull();
  });

  it('uses countedShownPicks for the shown count (re-showings in a week collapse)', () => {
    const { perUser } = computeMatchRate({ shown: [shown(), shown({ setId: 's2', shownAt: T + 1000 })] });
    expect(perUser.u1.shown).toBe(1);
  });

  it('gives per-user and overall results, with eligibility at 10+ ratings', () => {
    const places = Array.from({ length: MATCH_ELIGIBLE_MIN_RATINGS }, (_, i) => `p${i}`);
    const shownRows = [
      ...places.map((p) => shown({ landmarkId: p })),
      shown({ userId: 'u2', landmarkId: 'x', setId: 'sx' }),
    ];
    const ratings = [
      ...places.map((p, i) => rating({ landmarkId: p, level: i < 5 ? 'positive' : 'negative' })),
      rating({ userId: 'u2', landmarkId: 'x', pickSetId: 'sx', level: 'positive' }),
    ];
    const { perUser, overall } = computeMatchRate({ shown: shownRows, ratings });
    expect(perUser.u1.eligible).toBe(true);
    expect(perUser.u1.ratingCount).toBe(10);
    expect(perUser.u1.matchRate).toBe(0.5);
    expect(perUser.u2.eligible).toBe(false);
    expect(perUser.u2.matchRate).toBe(1);
    expect(overall.users).toBe(2);
    expect(overall.eligibleUsers).toBe(1);
    expect(overall.ratingCount).toBe(11);
    expect(overall.matchRate).toBeCloseTo(12 / 22);
    expect(overall.eligibleMatchRate).toBe(0.5);
  });

  it('returns totals only: no names, emails or locations', () => {
    const { perUser } = computeMatchRate({
      shown: [shown({ name: 'Secret Cafe', near: { lat: 1, lng: 2 }, email: 'x@y.z' })],
      taps: [tap()],
    });
    const json = JSON.stringify(perUser);
    expect(json).not.toMatch(/Secret|lat|lng|x@y/);
  });
});

describe('gatherMatchRateInputs', () => {
  it('maps Firestore rows to reactions, filtered to the requested users', () => {
    const inputs = gatherMatchRateInputs(
      {
        recommendationLog: [shown(), shown({ userId: 'other' })],
        pickFeedback: [
          { userId: 'u1', landmarkId: 'a', verdict: 'yes', at: T + 10, pickSetId: 's1', pickSurface: 'chat', pickShownAt: T },
          { userId: 'other', landmarkId: 'a', verdict: 'no', at: T + 10, pickSetId: 's1' },
        ],
        reviews: [{ userId: 'u1', landmarkId: 'a', ratingTier: 'probably-skip', pickSetId: 's1', updatedAt: { seconds: (T + 20) / 1000 } }],
      },
      ['u1']
    );
    expect(inputs.shown).toHaveLength(1);
    expect(inputs.taps).toEqual([{ userId: 'u1', landmarkId: 'a', level: 'positive', pickSetId: 's1', at: T + 10 }]);
    expect(inputs.ratings).toEqual([{ userId: 'u1', landmarkId: 'a', level: 'negative', pickSetId: 's1', at: T + 20 }]);
    const { perUser } = computeMatchRate(inputs);
    expect(perUser.u1.matchRate).toBeCloseTo(1 / 3);
  });

  it('maps all three taps and tiers to levels', () => {
    const inputs = gatherMatchRateInputs({
      pickFeedback: ['yes', 'unsure', 'no'].map((v) => ({ userId: 'u', landmarkId: 'a', verdict: v, at: 1, pickSetId: 's' })),
      reviews: ['highly-recommend', 'worth-trying', 'probably-skip'].map((t) => ({ userId: 'u', landmarkId: 'a', ratingTier: t, updatedAt: 1, pickSetId: 's' })),
    });
    expect(inputs.taps.map((x) => x.level)).toEqual(['positive', 'neutral', 'negative']);
    expect(inputs.ratings.map((x) => x.level)).toEqual(['positive', 'neutral', 'negative']);
  });
});
