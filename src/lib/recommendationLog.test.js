// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const added = [];
vi.mock('firebase/firestore', () => ({
  addDoc: async (_c, data) => {
    added.push(data);
  },
  collection: (_db, name) => ({ name }),
  serverTimestamp: () => 'TS',
}));
vi.mock('./firebase', () => ({ db: {} }));

import { recommendationEntries, logRecommendations, logShownPicks, resetShownMemory, makeSetId } from './recommendationLog';

const profile = { tagScores: { villanova: { food: 60 } }, tagScoresAt: { villanova: {} }, tagCounts: { villanova: { food: 8 } } };
const stop = (id, extra = {}) => ({ id, region: 'villanova', name: id, categories: ['food'], ...extra });

beforeEach(() => {
  added.length = 0;
  localStorage.clear();
  resetShownMemory();
});

describe('recommendationEntries', () => {
  it('keeps existing fields and adds setId, rank, shownAt, surface and predicted', () => {
    const [a, b] = recommendationEntries({ uid: 'u', source: 'map-picks', surface: 'map-sheet', setId: 'S', profile, stops: [stop('a'), stop('b', { rank: 3 })], at: 99 });
    expect(a).toMatchObject({ userId: 'u', source: 'map-picks', landmarkId: 'a', isTest: false, at: 99, setId: 'S', rank: 1, shownAt: 99, surface: 'map-sheet', predicted: 'positive' });
    expect(b.rank).toBe(3);
  });
  it('predicted is null without a profile, and old-style calls get no new fields', () => {
    expect(recommendationEntries({ uid: 'u', source: 's', setId: 'S', stops: [stop('a')] })[0].predicted).toBeNull();
    expect(recommendationEntries({ uid: 'u', source: 's', stops: [stop('a')] })[0]).not.toHaveProperty('setId');
  });
  it('ranks by original position even when an earlier stop is dropped', () => {
    const rows = recommendationEntries({ uid: 'u', source: 's', setId: 'S', stops: [{ external: true, name: 'x' }, stop('b')] });
    expect(rows[0].rank).toBe(2);
  });
});

describe('logShownPicks', () => {
  it('writes once per set per place, and never hands predicted back', async () => {
    const r1 = await logShownPicks({ uid: 'u', setId: 'S', source: 'map-picks', surface: 'map-sheet', profile, stops: [stop('a', { rank: 1 }), stop('b', { rank: 2 })] });
    const r2 = await logShownPicks({ uid: 'u', setId: 'S', source: 'map-picks', surface: 'map-sheet', profile, stops: [stop('a', { rank: 1 }), stop('c', { rank: 3 })] });
    expect(r1).toBe(2);
    expect(r2).toBe(1);
    expect(added.map((r) => r.landmarkId)).toEqual(['a', 'b', 'c']);
    expect(added.every((r) => r.predicted === 'positive')).toBe(true);
  });
  it('a new set logs the same place again; no uid or setId logs nothing', async () => {
    await logShownPicks({ uid: 'u', setId: 'S1', source: 's', surface: 'chat', stops: [stop('a')] });
    await logShownPicks({ uid: 'u', setId: 'S2', source: 's', surface: 'chat', stops: [stop('a')] });
    await logShownPicks({ uid: null, setId: 'S3', source: 's', stops: [stop('a')] });
    await logShownPicks({ uid: 'u', source: 's', stops: [stop('a')] });
    expect(added).toHaveLength(2);
  });
  it('logRecommendations returns a count, not the rows', async () => {
    expect(await logRecommendations({ uid: 'u', source: 's', setId: 'S', stops: [stop('a')] })).toBe(1);
  });
});

describe('makeSetId', () => {
  it('is uid-timestamp-random and unique', () => {
    expect(makeSetId('u', 5)).toMatch(/^u-5-[a-z0-9]+$/);
    expect(makeSetId('u', 5)).not.toBe(makeSetId('u', 5));
  });
});

describe('Mapr Phase 1 telemetry on shown rows', () => {
  it('writes only known, typed telemetry fields', async () => {
    const { telemetryFields } = await import('./recommendationLog');
    const t = telemetryFields({
      rankPosition: 2,
      scoreBeforeDecay: 30,
      distanceKm: 0.84,
      decayMultiplier: 0.64,
      scoreAfterDecay: 19.2,
      collabBoost: 0.05,
      ncfScore: 0.71,
      finalScore: 0.6,
      explore: true,
      noveltyScore: 0.8,
      epsilon: 0.2,
      epsilonReason: 'base',
      rankLatencyMs: 4.2,
      revisit: false,
      fallbacks: ['ncf-no-user', 42],
      variants: { ncf: 'treatment', exploration: 'control', bogus: 'x', distanceDecay: 'weird' },
      userEmail: 'nope@example.com',
    });
    expect(t).toMatchObject({ telemetry: true, rankPosition: 2, distanceKm: 0.84, ncfScore: 0.71, explore: true, fallbacks: ['ncf-no-user'], variants: { ncf: 'treatment', exploration: 'control' } });
    expect(t.userEmail).toBeUndefined();
    expect(telemetryFields({ ncfScore: 7, distanceKm: -1, rankPosition: 0 })).toMatchObject({ ncfScore: 1, distanceKm: 0, rankPosition: null });
    expect(telemetryFields(null)).toEqual({});
  });

  it('adds them to a row only for picks that carry telemetry', () => {
    const [withT, without] = recommendationEntries({
      uid: 'u1',
      source: 'map-picks',
      surface: 'map-sheet',
      setId: 's',
      stops: [
        { id: 'a', region: 'milan', telemetry: { distanceKm: 1, variants: { ncf: 'control' } } },
        { id: 'b', region: 'milan' },
      ],
    });
    expect(withT).toMatchObject({ telemetry: true, distanceKm: 1, variants: { ncf: 'control' } });
    expect(without.telemetry).toBeUndefined();
    expect(without.distanceKm).toBeUndefined();
  });
});
