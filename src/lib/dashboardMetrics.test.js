import { describe, it, expect } from 'vitest';
import { retention } from './adminStats.js';
import { accuracyDocs, bigMissDocs, engagementDocs, growthDocs, lastDates, maprFlatFields, presenceDocs, retentionDocs, slackAlerts, tasteDocs, tipDocs } from './dashboardMetrics.js';

const DAY = 86400000;
const D = '2026-09-20';
const T = Date.parse(`${D}T12:00:00Z`);

it('lastDates: oldest first, ending on the given day', () => {
  expect(lastDates('2026-09-02', 3)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
});

describe('growthDocs', () => {
  const ds = {
    users: [{ uid: 'a', createdAt: T }, { uid: 'b', createdAt: T - DAY }],
    openDays: [{ uid: 'a', date: D }, { uid: 'b', date: D }, { uid: 'b', date: '2026-09-19' }],
    checkins: [
      { userId: 'a', landmarkId: 'x', createdAt: T - DAY },
      { userId: 'a', landmarkId: 'x', createdAt: T },
      { userId: 'a', landmarkId: 'y', createdAt: T },
      { userId: 'b', landmarkId: 'z', createdAt: T, ratingOnly: true },
    ],
  };
  it('counts active, new, visits, repeats and the running total', () => {
    const [d19, d20] = growthDocs(ds, ['2026-09-19', D]);
    expect(d19).toMatchObject({ active_users: 1, new_users: 1, landmarks_visited: 1, total_landmarks_visited_cumulative: 1, repeat_landmark_visits: 0 });
    expect(d20).toMatchObject({ active_users: 2, new_users: 1, landmarks_visited: 2, total_landmarks_visited_cumulative: 3, repeat_landmark_visits: 1 });
  });
  it('adds active users outside family next to the total', () => {
    const [, d20] = growthDocs({ ...ds, familyUids: ['a'] }, ['2026-09-19', D]);
    expect(d20).toMatchObject({ active_users: 2, active_users_outside_family: 1 });
  });
});

describe('engagementDocs', () => {
  it('tap-to-visit, rating distribution and average, dwell not tracked', () => {
    const ds = {
      pickFeedback: [{ userId: 'a', landmarkId: 'x', verdict: 'yes', at: T }, { userId: 'a', landmarkId: 'y', verdict: 'yes', at: T }],
      checkins: [{ userId: 'a', landmarkId: 'x', createdAt: T + 3600000 }],
      reviews: [{ userId: 'a', landmarkId: 'x', ratingTier: 'highly-recommend', ratedAt: T }, { userId: 'b', landmarkId: 'y', ratingTier: 'probably-skip', ratedAt: T }],
      recommendationLog: [],
    };
    const [d] = engagementDocs(ds, [D]);
    expect(d).toMatchObject({ tap_to_visit_rate: 0.5, avg_rating: 3, avg_dwell_time_s: null, rating_distribution: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 } });
  });
});

describe('retentionDocs', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const c = '2026-08-01';
  const t0 = Date.parse(`${c}T10:00:00Z`);
  it('counts opens ON day 7 / 30, null until that day is over, and churn', () => {
    // Tracking began on the signup day (b's open on 08-01).
    const ds = {
      users: [{ uid: 'a', createdAt: t0 }, { uid: 'b', createdAt: t0 }],
      openDays: [{ uid: 'b', date: '2026-08-01' }, { uid: 'a', date: '2026-08-08' }, { uid: 'a', date: '2026-08-31' }, { uid: 'a', date: '2026-09-15' }, { uid: 'b', date: '2026-08-10' }],
    };
    const [r] = retentionDocs(ds, [c], now);
    expect(r).toMatchObject({ day_0: 2, day_7: 1, day_30: 1, day_90: null, retention_7_day: 0.5, retention_30_day: 0.5, churn_rate: 0.5 });
  });
  it('matches retention() in adminStats: pre-tracking signups and family left out', () => {
    const ds = {
      users: [{ uid: 'old', createdAt: t0 - 5 * DAY }, { uid: 'me', createdAt: t0 }, { uid: 'x', createdAt: t0 }, { uid: 'y', createdAt: t0 }],
      openDays: [{ uid: 'x', date: c }, { uid: 'x', date: '2026-08-08' }, { uid: 'me', date: '2026-08-08' }, { uid: 'old', date: '2026-08-08' }],
      familyUids: ['me'],
    };
    const [old] = retentionDocs(ds, ['2026-07-27'], now);
    expect(old.day_0).toBe(0);
    const [r] = retentionDocs(ds, [c], now);
    expect(r).toMatchObject({ day_0: 2, day_7: 1, retention_7_day: 0.5 });
    const d7 = retention(ds, 7, now);
    expect(d7).toMatchObject({ cohort: 2, returned: 1 });
  });
});

describe('accuracy and big misses', () => {
  const row = (userId, landmarkId, extra = {}) => ({ userId, landmarkId, region: 'milan', categories: ['food'], setId: 's', shownAt: T, isTest: false, predicted: 'positive', ...extra });
  const ds = {
    recommendationLog: [row('a', 'l1'), row('b', 'l1'), row('c', 'l1'), row('d', 'l1', { categories: ['art-museums'], region: 'paris' }), row('e', 'l2')],
    pickFeedback: [{ userId: 'd', landmarkId: 'l1', verdict: 'yes', at: T + 10 }],
    reviews: [{ userId: 'e', landmarkId: 'l2', ratingTier: 'probably-skip', ratedAt: T + 10 }],
    checkins: [],
  };

  it('groups by main category and by city', () => {
    const { byCategory, byCity } = accuracyDocs(ds, D);
    expect(byCategory.categories.food).toMatchObject({ sample_size: 4, match_rate: 0, skip_rate: 0.75 });
    expect(byCategory.categories['art-museums']).toMatchObject({ sample_size: 1, match_rate: 1 });
    expect(byCity.cities.paris.sample_size).toBe(1);
  });

  it('lists places predicted positive that were skipped a lot or hated', () => {
    const misses = bigMissDocs(ds, (r, id) => `Name ${id}`);
    expect(misses.map((m) => m.landmark_id)).toEqual(['l1', 'l2']);
    expect(misses[0]).toMatchObject({ id: 'milan__l1', skip_count: 3, hate_count: 0, landmark_name: 'Name l1', expected_rating: 5 });
    expect(misses[1]).toMatchObject({ hate_count: 1, actual_rating: 1 });
    expect(JSON.stringify(misses)).not.toMatch(/"a"|"b"|"c"/);
  });
});

it('tasteDocs: each user\'s latest score as of that day', () => {
  const ds = { tasteHistory: [{ userId: 'a', at: T - DAY, score: 50 }, { userId: 'a', at: T, score: 70 }, { userId: 'b', at: T + DAY, score: 90 }] };
  const [d19, d20] = tasteDocs(ds, ['2026-09-19', D]);
  expect(d19).toEqual({ date: '2026-09-19', avg_taste_score: 0.5, users_with_taste_score: 1 });
  expect(d20).toEqual({ date: D, avg_taste_score: 0.7, users_with_taste_score: 1 });
});

it('maprFlatFields maps a daily report to the dashboard fields', () => {
  const f = maprFlatFields({ matchRate: 0.6, skipRate: 0.3, repeatRate: 0.1, novelty: { weeklyNewShare: 0.25 }, stagnation: { stagnating: 2 }, models: { ncfTestAccuracy: 0.8 }, experiments: { ncf: { days: 3, arms: { control: { ctr: 0.2, shown: 10 }, treatment: { ctr: 0.3, shown: 5 } }, ctr: { pValue: 0.4 } } } });
  expect(f).toMatchObject({ match_rate: 0.6, novelty_percentage: 25, stagnation_users: 2, ncf_model_health: 0.8, a_b_control_rate: 0.2, a_b_treatment_rate: 0.3, a_b_days: 3 });
});

it('slackAlerts: a >20% one-day match rate drop and a failed NCF training', () => {
  expect(slackAlerts({ matchRate: 0.5 }, { matchRate: 0.7 }, null)[0]).toMatch(/fell 29%/);
  expect(slackAlerts({ matchRate: 0.65 }, { matchRate: 0.7 }, null)).toEqual([]);
  expect(slackAlerts({}, null, { ok: false, reason: 'boom' })[0]).toMatch(/failed to train: boom/);
  expect(slackAlerts({}, null, { ok: false, reason: 'not-enough-data' })).toEqual([]);
});

describe('presenceDocs (verified visits per day)', () => {
  it('counts checked, verified and failed real check-ins, with fail reasons', () => {
    const at = Date.parse('2026-10-10T12:00:00Z');
    const ds = {
      checkins: [
        { userId: 'a', createdAt: at, presence: { verified: true, reason: null } },
        { userId: 'a', createdAt: at, presence: { verified: false, reason: 'too-far' } },
        { userId: 'b', createdAt: at, presence: { verified: false, reason: 'too-far' } },
        { userId: 'b', createdAt: at, presence: null },
        { userId: 'c', createdAt: at, ratingOnly: true, presence: null },
      ],
    };
    const [day, empty] = presenceDocs(ds, ['2026-10-10', '2026-10-11']);
    expect(day).toEqual({ date: '2026-10-10', checkins: 4, checked: 3, verified: 1, failed: 2, verified_rate: 0.3333, fail_reasons: { 'too-far': 2 } });
    expect(empty).toMatchObject({ checkins: 0, checked: 0, verified_rate: null });
  });
});


describe('tipDocs', () => {
  it('counts tips by state, posted and impressions that day, and people with a live tip from the last 30 days', () => {
    const day = Date.parse('2026-10-12T12:00:00Z');
    const ds = {
      tips: [
        { authorUid: 'a', landmarkId: 'x', region: 'philly', status: 'live', hidden: false, reportCount: 1, createdAt: day, helpful: 2, saved: 1 },
        { authorUid: 'b', landmarkId: 'x', region: 'philly', status: 'live', hidden: false, reportCount: 0, createdAt: day - 40 * 864e5, helpful: 0, saved: 0 },
        { authorUid: 'c', landmarkId: 'y', region: 'villanova', status: 'live', hidden: true, reportCount: 2, createdAt: day },
        { authorUid: 'd', landmarkId: 'z', region: 'philly', status: 'held', createdAt: day },
        { authorUid: 'e', landmarkId: 'z', region: 'philly', status: 'removed', createdAt: 1 },
      ],
      tipImpressions: [{ shownAt: day, tipIds: ['1', '2'] }, { shownAt: 5, tipIds: ['3'] }],
    };
    const [doc] = tipDocs(ds, ['2026-10-12']);
    expect(doc).toMatchObject({ date: '2026-10-12', live: 2, held: 1, hidden: 1, removed: 1, withdrawn: 0, reported_live: 1, live_places: 1, posted: 3, impressions: 2, authors_30d: 1, helpful_total: 2, saved_total: 1, live_by_region: { philly: 2 } });
  });
});
