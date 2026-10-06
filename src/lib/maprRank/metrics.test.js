import { describe, it, expect } from 'vitest';
import { alertsFor, annotateShown, computeDailyReport, normalCdf, percentile, reportToCsv, slackMessage, sparkline, stagnatingUserIds, twoProportionTest } from './metrics.js';

const DAY = 86400000;
const D = '2026-09-20';
const T = Date.parse(`${D}T12:00:00Z`);
const row = (userId, landmarkId, extra = {}) => ({ userId, landmarkId, region: 'milan', setId: `${userId}-set`, shownAt: T, isTest: false, ...extra });

describe('statistics', () => {
  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 5);
  });

  it('two-proportion z-test: 20% vs 25% of 1000 is significant', () => {
    const r = twoProportionTest(200, 1000, 250, 1000);
    expect(r.z).toBeCloseTo(0.05 / Math.sqrt(0.225 * 0.775 * (2 / 1000)), 3); // 2.677
    expect(r.pValue).toBeCloseTo(0.0074, 3);
    expect(r.significant).toBe(true);
    expect(r.lift).toBeCloseTo(0.25, 6);
    expect(r.ci[0]).toBeGreaterThan(0);
    expect(r.ci[0]).toBeLessThan(0.05);
    expect(r.ci[1]).toBeGreaterThan(0.05);
  });

  it('is not significant on tiny or equal samples, and safe on empty arms', () => {
    expect(twoProportionTest(1, 10, 2, 10).significant).toBe(false);
    expect(twoProportionTest(5, 50, 5, 50).pValue).toBe(1);
    expect(twoProportionTest(0, 0, 1, 10)).toMatchObject({ pValue: null, significant: false });
  });

  it('percentile (nearest rank)', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('annotateShown: user_action per shown pick', () => {
  const ds = {
    recommendationLog: [row('a', 'l1'), row('a', 'l2'), row('a', 'l3'), row('a', 'l4'), row('b', 'l1', { isTest: true }), row('b', 'l5', { setId: null })],
    pickFeedback: [{ userId: 'a', landmarkId: 'l2', verdict: 'yes', at: T + DAY }],
    reviews: [{ userId: 'a', landmarkId: 'l3', ratingTier: 'highly-recommend', ratedAt: T + 2 * DAY }],
    checkins: [
      { userId: 'a', landmarkId: 'l3', createdAt: T + 2 * DAY },
      { userId: 'a', landmarkId: 'l4', createdAt: T - 5 * DAY },
      { userId: 'a', landmarkId: 'l4', createdAt: T + 9 * DAY },
    ],
  };
  const out = annotateShown(ds);

  it('drops test rows and rows without a set', () => {
    expect(out).toHaveLength(4);
  });

  it('labels skipped / viewed / rated, and repeats', () => {
    const by = Object.fromEntries(out.map((r) => [r.landmarkId, r]));
    expect(by.l1.action).toBe('skipped');
    expect(by.l2.action).toBe('viewed');
    expect(by.l3).toMatchObject({ action: 'rated', visited: true, rating: 5 });
    expect(by.l4).toMatchObject({ action: 'skipped', repeat: true }); // the visit after 9 days is outside the window
    expect(by.l1.dwellSeconds).toBeNull();
  });
});

describe('computeDailyReport', () => {
  const variants = (ncf, exploration = 'control') => ({ distanceDecay: 'treatment', itemSimilarity: 'treatment', ncf, exploration });
  const ds = {
    users: [],
    openDays: [{ uid: 'a', date: D }, { uid: 'b', date: D }, { uid: 'c', date: D }],
    recommendationLog: [
      row('a', 'l1', { distanceKm: 0.4, collabBoost: 0, rankLatencyMs: 4, variants: variants('control'), setId: 's1' }),
      row('a', 'l2', { distanceKm: 1.2, collabBoost: 0.07, rankLatencyMs: 4, variants: variants('control'), setId: 's1' }),
      row('b', 'l1', { distanceKm: 2.5, collabBoost: 0.2, rankLatencyMs: 6, variants: variants('treatment', 'treatment'), explore: true, noveltyScore: 0.8, epsilon: 0.2, setId: 's2' }),
      row('b', 'l9', { distanceKm: 6, collabBoost: 0.03, rankLatencyMs: 6, variants: variants('treatment', 'treatment'), fallbacks: ['ncf-latency'], setId: 's2' }),
      row('c', 'old', { shownAt: T - 3 * DAY, setId: 's3' }),
    ],
    pickFeedback: [{ userId: 'a', landmarkId: 'l1', verdict: 'yes', at: T + 1000, pickSetId: 's1' }],
    reviews: [
      { userId: 'b', landmarkId: 'l1', ratingTier: 'highly-recommend', ratedAt: T + 2000, pickSetId: 's2' },
      { userId: 'c', landmarkId: 'zz', ratingTier: 'probably-skip', ratedAt: T + 3000 },
    ],
    checkins: [{ userId: 'b', landmarkId: 'l1', createdAt: T + 1500 }],
    models: { ncf: { trainedAt: T - DAY, evaluation: { testAccuracy: 0.81 } }, similarity: { computedAt: T - DAY, ms: 300 } },
  };
  const r = computeDailyReport(ds, { date: D, now: T + 10 * DAY });

  it('counts the day\'s shown picks, users and sets', () => {
    expect(r.totals).toEqual({ shown: 4, users: 2, sets: 2 });
    expect(r.recommendationsPerUser).toBe(2);
    expect(r.matured).toBe(true);
  });

  it('computes skip, CTR, visit-and-love, ratings', () => {
    expect(r.skipRate).toBe(0.5);
    expect(r.ctr).toBe(0.5);
    expect(r.visitLoveRate).toBe(0.25);
    expect(r.avgRating).toBe(3); // the day's ratings: 5 and 1
    expect(r.matchRate).toBeCloseTo(1, 6); // a "yes" tap and a loved rating
  });

  it('distance, boost and exploration distributions', () => {
    expect(r.distance).toMatchObject({ n: 4, within1_5km: 0.5, within3km: 0.75, p50: 1.2 });
    expect(r.boost).toMatchObject({ zero: 0.25, upTo5: 0.25, upTo10: 0.25, over10: 0.25 });
    expect(r.exploration).toMatchObject({ share: 0.25, avgNovelty: 0.8, skipRate: 0, avgRating: 5 });
    expect(r.latency).toMatchObject({ sets: 2, p99Ms: 6 });
  });

  it('weekly novelty: picks the user had never been shown before', () => {
    expect(r.novelty.weeklyNewShare).toBe(1);
  });

  it('splits the A/B arms by the logged variant', () => {
    const e = r.experiments.ncf;
    expect(e.started).toBe(D);
    expect(e.arms.control).toMatchObject({ shown: 2, clicked: 1, users: 1 });
    expect(e.arms.treatment).toMatchObject({ shown: 2, clicked: 1, users: 1 });
    expect(e.decision).toBe('collecting');
    expect(r.experiments.exploration.arms.treatment.explorationShare).toBe(0.5);
  });

  it('flags stagnating users and raises alerts', () => {
    expect(r.stagnation).toMatchObject({ activeUsers: 3, stagnating: 3, share: 1 });
    expect(r.alerts.join(' ')).toMatch(/stagnating/);
    expect(r.alerts.join(' ')).toMatch(/Skip rate 50%/);
    expect(r.alerts.join(' ')).toMatch(/NCF fell back/);
    expect(r.models.ncfTestAccuracy).toBe(0.81);
  });

  it('never carries a uid', () => {
    const json = JSON.stringify(r);
    for (const uid of ['"a"', '"b"', '"c"']) expect(json).not.toContain(uid);
  });

  it('exports CSV and a Slack message with a trend', () => {
    const csv = reportToCsv(r);
    expect(csv.split('\n')[0]).toBe('metric,value');
    expect(csv).toContain('skipRate,0.5');
    expect(csv).toContain('distance.within3km,0.75');
    const msg = slackMessage(r, [{ ...r, date: '2026-09-19', skipRate: 0.6 }]);
    expect(msg).toContain('Mapr daily — 2026-09-20');
    expect(msg).toContain('Skip rate: *50%*');
    expect(msg).toMatch(/NCF A\/B day 1/);
  });

  it('lists per-user stagnation ids only through its own helper', () => {
    expect(stagnatingUserIds(ds, T + DAY).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('Mapr v2 rollout report', () => {
  const v = (arm) => ({ distanceDecay: 'treatment', itemSimilarity: 'treatment', ncf: 'treatment', exploration: 'control', maprV2: arm });
  const prior = (userId, n) => Array.from({ length: n }, (_, k) => ({ userId, landmarkId: `p${k}`, ratingTier: 'worth-trying', ratedAt: T - (k + 2) * DAY }));
  const ds = {
    users: [],
    openDays: [],
    recommendationLog: [
      // New users (no ratings before): one per arm.
      row('n1', 'l1', { variants: v('control'), setId: 'a' }),
      row('n2', 'l1', { variants: v('treatment'), ncfModel: 'v2', setId: 'b' }),
      // Established users (5+ ratings before), in Madrid.
      row('e1', 'l2', { region: 'madrid', variants: v('control'), setId: 'c' }),
      row('e2', 'l2', { region: 'madrid', variants: v('treatment'), ncfModel: 'v1', setId: 'd' }),
    ],
    pickFeedback: [{ userId: 'n2', landmarkId: 'l1', verdict: 'yes', at: T + 1000 }],
    reviews: [...prior('e1', 5), ...prior('e2', 6), { userId: 'e2', landmarkId: 'l2', ratingTier: 'highly-recommend', ratedAt: T + 2000 }],
    checkins: [{ userId: 'e2', landmarkId: 'l2', createdAt: T + 1500 }],
    models: { ncf: { evaluation: { testAccuracy: 0.7, testAccuracyCatalog: 0.7, testAccuracyRegion: 0.6 } }, ncfV2: { trainedAt: T - DAY, version: 'v2-1', active: false, evaluation: { testAccuracyCatalog: 0.72, testAccuracyRegion: 0.66 } } },
  };
  const r = computeDailyReport(ds, { date: D, now: T + 10 * DAY });
  const e = r.experiments.maprV2;

  it('runs the A/B on the maprV2 arm', () => {
    expect(e.started).toBe(D);
    expect(e.arms.control).toMatchObject({ shown: 2, clicked: 0 });
    expect(e.arms.treatment).toMatchObject({ shown: 2, clicked: 2 });
    expect(e.overall.gain.ctr).toBe(1);
  });

  it('reports how many treatment picks the v2 model ranked', () => {
    expect(e.servedV2Share).toBe(0.5);
  });

  it('splits new users (under 5 ratings) from established ones', () => {
    expect(e.newUsers.control).toMatchObject({ shown: 1, users: 1, ctr: 0 });
    expect(e.newUsers.treatment).toMatchObject({ shown: 1, ctr: 1 });
    expect(e.newUsers.gain.ctr).toBe(1);
    expect(e.established.treatment).toMatchObject({ shown: 1, visitLoveRate: 1, avgPickRating: 5 });
    expect(e.established.gain.visitLoveRate).toBe(1);
  });

  it('gives each region its own A/B', () => {
    expect(Object.keys(e.byRegion)).toEqual(['madrid', 'milan']);
    expect(e.byRegion.madrid.gain.ctr).toBe(1);
    expect(e.byRegion.milan.control.shown).toBe(1);
  });

  it('puts v1 and v2 holdout accuracy side by side', () => {
    expect(r.models).toMatchObject({ ncfTestAccuracyCatalog: 0.7, ncfTestAccuracyRegion: 0.6, ncfV2TestAccuracyCatalog: 0.72, ncfV2TestAccuracyRegion: 0.66, ncfV2Version: 'v2-1', ncfV2Active: false });
  });

  it('adds a Slack line and never carries a uid', () => {
    expect(slackMessage(r)).toMatch(/MAPRV2 A\/B day 1/);
    const json = JSON.stringify(r);
    for (const uid of ['"n1"', '"n2"', '"e1"', '"e2"']) expect(json).not.toContain(uid);
  });
});

describe('alerts', () => {
  const quiet = { latency: { p99Ms: 20 }, skipRate: 0.1, exploration: { skipRate: 0.1 }, repeatRate: 0.1, stagnation: { share: 0.1 }, fallbacks: {}, models: { ncfTrainedDaysAgo: 2, similarityComputedDaysAgo: 2 } };
  it('is empty when everything is in range', () => {
    expect(alertsFor(quiet)).toEqual([]);
  });
  it('fires each threshold', () => {
    const loud = { ...quiet, latency: { p99Ms: 200 }, skipRate: 0.4, exploration: { skipRate: 0.5 }, repeatRate: 0.35, models: { ncfTrainedDaysAgo: 9, similarityComputedDaysAgo: null } };
    expect(alertsFor(loud)).toHaveLength(6);
  });
});

it('sparkline', () => {
  expect(sparkline([0, 0.5, 1])).toBe('▁▅█');
  expect(sparkline([null, 2, 2])).toBe(' ▄▄');
  expect(sparkline([])).toBe('');
});
