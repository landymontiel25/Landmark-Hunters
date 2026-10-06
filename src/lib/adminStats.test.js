import { describe, it, expect } from 'vitest';
import { computeMetrics, retention, growthStats, growthGoalFor, dateUtc } from './adminStats';
import { STATS_DAY_MS } from './statsConstants';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const day = (n) => Date.parse('2026-09-01T00:00:00Z') + n * STATS_DAY_MS; // day 0 = Sept 1
const byId = (ms, id) => ms.find((m) => m.id === id);
const run = (ds, now = NOW) => computeMetrics({ users: [], openDays: [], reviews: [], checkins: [], referrals: [], recommendationLog: [], pickFeedback: [], placeScores: [], tasteHistory: [], ...ds }, now);

// A user with `n` picks shown, each rated: `good` of them highly-recommend.
function pickUser(uid, n, good) {
  const rows = [];
  const reviews = [];
  for (let i = 0; i < n; i += 1) {
    const t = day(1) + i * 1000;
    rows.push({ userId: uid, landmarkId: `p${i}`, setId: `s${i}`, shownAt: t, predicted: 'positive' });
    reviews.push({ userId: uid, landmarkId: `p${i}`, pickSetId: `s${i}`, ratingTier: i < good ? 'highly-recommend' : 'probably-skip', updatedAt: t + 500, ratedAt: t + 500 });
  }
  return { rows, reviews };
}

describe('match rate', () => {
  it('green above 70% among users with 10+ ratings', () => {
    const { rows, reviews } = pickUser('a', 10, 8);
    const m = byId(run({ recommendationLog: rows, reviews }), 'matchRate');
    expect(m.value).toBe(80);
    expect(m.status).toBe('met');
    expect(m.headline).toBe(true);
    expect(m.n).toBe(1);
  });
  it('red when at or below 70%', () => {
    const { rows, reviews } = pickUser('a', 10, 7);
    const m = byId(run({ recommendationLog: rows, reviews }), 'matchRate');
    expect(m.value).toBe(70);
    expect(m.status).toBe('missed');
  });
  it("can't measure yet with nobody at 10 ratings", () => {
    const { rows, reviews } = pickUser('a', 4, 4);
    const m = byId(run({ recommendationLog: rows, reviews }), 'matchRate');
    expect(m.status).toBe('unknown');
    expect(m.value).toBeNull();
  });
  it('baseline is how often the usual answer would have matched the same reactions', () => {
    const { rows, reviews } = pickUser('a', 10, 8);
    const placeScores = reviews.map((r, i) => ({ userId: 'a', landmarkId: r.landmarkId, latestLevel: i < 8 ? 'positive' : 'negative' }));
    const m = byId(run({ recommendationLog: rows, reviews, placeScores }), 'matchRate');
    expect(m.baseline.value).toBe(80);
  });
});

describe('growth', () => {
  // cohort start = earliest createdAt = Sept 1 (week 1). NOW is Oct 20 = week 7 (day 49 -> week 8 starts day 49).
  const usersIn = (week, n) => Array.from({ length: n }, (_, i) => ({ uid: `u${week}-${i}`, createdAt: day((week - 1) * 7 + 1) + i }));
  it('goal depends on the week of the measured week; green at 100%+ in weeks 1-4', () => {
    const users = [{ uid: 'first', createdAt: day(0) }, ...usersIn(2, 2), ...usersIn(3, 4)];
    const now = day(7 * 3 + 1); // in week 4, so week 3 is the last full one
    const m = byId(run({ users }, now), 'growth');
    expect(m.value).toBe(100); // week 3 (4) vs week 2 (2)
    expect(m.status).toBe('met');
    expect(m.goal).toContain('week 3');
  });
  it('red when growth is below the goal', () => {
    const users = [{ uid: 'first', createdAt: day(0) }, ...usersIn(2, 4), ...usersIn(3, 5)];
    const m = byId(run({ users }, day(7 * 3 + 1)), 'growth');
    expect(m.value).toBe(25);
    expect(m.status).toBe('missed');
  });
  it("can't measure with under two full weeks or an empty previous week", () => {
    expect(byId(run({ users: [{ uid: 'a', createdAt: day(0) }] }, day(8)), 'growth').status).toBe('unknown');
    const users = [{ uid: 'first', createdAt: day(0) }, ...usersIn(3, 3)];
    expect(byId(run({ users }, day(7 * 3 + 1)), 'growth').status).toBe('unknown');
  });
  it('goals by week of the app life', () => {
    expect(growthGoalFor(2).minPct).toBe(100);
    expect(growthGoalFor(5).minPct).toBe(50);
    expect(growthGoalFor(12).minPct).toBe(20);
  });
  it('weekly series starts at the first user', () => {
    const g = growthStats({ users: [{ uid: 'a', createdAt: day(0) }, { uid: 'b', createdAt: day(8) }] }, day(15));
    expect(g.weeks.map((w) => w.newUsers)).toEqual([1, 1, 0]);
  });
});

describe('retention', () => {
  const user = (uid, d) => ({ uid, createdAt: day(d) + 3600000 });
  const open = (uid, d) => ({ uid, date: dateUtc(day(d)) });
  it('day 1: green above 40%, red below, only users whose day 1 is over and who joined after tracking began', () => {
    const users = [user('a', 1), user('b', 1), user('c', 1), user('old', -5)];
    const openDays = [open('a', 1), open('a', 2), open('b', 1), open('old', 1)]; // a, b are retained?? a opened day 1 (same day as signup)
    // day-1 for a = day 2: a opened; b did not; c did not; "old" joined before tracking
    const r = retention({ users, openDays }, 1, day(10));
    expect(r.cohort).toBe(3);
    expect(r.returned).toBe(1);
    expect(r.pct).toBeCloseTo(33.33, 1);
    const m = byId(run({ users, openDays }, day(10)), 'retentionD1');
    expect(m.status).toBe('missed');
    const good = byId(run({ users: [user('a', 1)], openDays: [open('a', 1), open('a', 2)] }, day(10)), 'retentionD1');
    expect(good.value).toBe(100);
    expect(good.status).toBe('met');
  });
  it('day 30 is green above 60% and unknown until someone is 30 days old', () => {
    const users = [user('a', 1), user('b', 1)];
    const openDays = [open('a', 31), open('b', 31), open('a', 1)];
    expect(byId(run({ users, openDays }, day(20)), 'retentionD30').status).toBe('unknown');
    const m = byId(run({ users, openDays }, day(40)), 'retentionD30');
    expect(m.value).toBe(100);
    expect(m.status).toBe('met');
  });
  it("can't measure without any open days", () => {
    const m = byId(run({ users: [user('a', 1)] }, day(40)), 'retentionD1');
    expect(m.status).toBe('unknown');
    expect(m.note).toMatch(/daily open record/);
  });
});

describe('sessions, check-ins, first check-in', () => {
  const d = (n) => dateUtc(day(n));
  const openDays = [{ uid: 'a', date: d(3) }, { uid: 'b', date: d(3) }];
  const rate = (uid, n, at) => Array.from({ length: n }, (_, i) => ({ userId: uid, landmarkId: `l${i}`, ratedAt: at + i }));
  it('ratings per session: green inside 3-5, red outside', () => {
    const ok = byId(run({ openDays, reviews: [...rate('a', 4, day(3) + 1000), ...rate('b', 4, day(3) + 1000)] }), 'ratingsPerSession');
    expect(ok.value).toBe(4);
    expect(ok.status).toBe('met');
    const low = byId(run({ openDays, reviews: rate('a', 2, day(3) + 1000) }), 'ratingsPerSession');
    expect(low.value).toBe(1);
    expect(low.status).toBe('missed');
    const high = byId(run({ openDays, reviews: [...rate('a', 7, day(3) + 1000), ...rate('b', 7, day(3) + 1000)] }), 'ratingsPerSession');
    expect(high.status).toBe('missed');
  });
  it("ratings per session and check-ins per user-day can't be measured without sessions", () => {
    const ms = run({ reviews: rate('a', 4, day(3)) });
    expect(byId(ms, 'ratingsPerSession').status).toBe('unknown');
    expect(byId(ms, 'checkinsPerDailyUser').status).toBe('unknown');
  });
  it('check-ins per daily user: real check-ins only, 1.5+ is green', () => {
    const c = (uid, ratingOnly = false) => ({ userId: uid, createdAt: day(3) + 5000, ratingOnly });
    const green = byId(run({ openDays, checkins: [c('a'), c('a'), c('b'), c('b'), c('b'), c('a', true)] }), 'checkinsPerDailyUser');
    expect(green.value).toBe(2.5);
    expect(green.status).toBe('met');
    const red = byId(run({ openDays, checkins: [c('a')] }), 'checkinsPerDailyUser');
    expect(red.value).toBe(0.5);
    expect(red.status).toBe('missed');
  });
  it('time to first check-in: median under 2 hours is green, over is red, none is unknown', () => {
    const users = [{ uid: 'a', createdAt: day(1) }, { uid: 'b', createdAt: day(1) }, { uid: 'c', createdAt: day(1) }];
    const at = (h) => day(1) + h * 3600000;
    const green = byId(run({ users, checkins: [{ userId: 'a', createdAt: at(0.5) }, { userId: 'b', createdAt: at(1) }, { userId: 'c', createdAt: at(30) }] }), 'timeToFirstCheckin');
    expect(green.value).toBe(1);
    expect(green.status).toBe('met');
    const red = byId(run({ users, checkins: [{ userId: 'a', createdAt: at(3) }, { userId: 'b', createdAt: at(5), ratingOnly: false }] }), 'timeToFirstCheckin');
    expect(red.status).toBe('missed');
    const none = byId(run({ users, checkins: [{ userId: 'a', createdAt: at(1), ratingOnly: true }] }), 'timeToFirstCheckin');
    expect(none.status).toBe('unknown');
  });
});

describe('referrals and signups', () => {
  it('referral coefficient: invited users per inviter, above 1.0 is green', () => {
    const refs = [{ referrerUid: 'a', referredUid: 'x' }, { referrerUid: 'a', referredUid: 'y' }, { referrerUid: 'b', referredUid: 'z' }];
    const m = byId(run({ referrals: refs }), 'referralCoefficient');
    expect(m.value).toBe(1.5);
    expect(m.status).toBe('met');
    const red = byId(run({ referrals: [{ referrerUid: 'a', referredUid: 'x' }] }), 'referralCoefficient');
    expect(red.value).toBe(1);
    expect(red.status).toBe('missed');
    expect(byId(run({}), 'referralCoefficient').status).toBe('unknown');
  });
  it('viral signup rate: share of recent new users that were referred, above 40% green', () => {
    const users = [1, 2, 3, 4, 5].map((i) => ({ uid: `u${i}`, createdAt: NOW - i * STATS_DAY_MS }));
    const green = byId(run({ users, referrals: [{ referrerUid: 'z', referredUid: 'u1' }, { referrerUid: 'z', referredUid: 'u2' }, { referrerUid: 'z', referredUid: 'u3' }] }), 'viralSignupRate');
    expect(green.value).toBe(60);
    expect(green.status).toBe('met');
    const red = byId(run({ users, referrals: [{ referrerUid: 'z', referredUid: 'u1' }] }), 'viralSignupRate');
    expect(red.value).toBe(20);
    expect(red.status).toBe('missed');
    expect(byId(run({ users: [{ uid: 'old', createdAt: NOW - 90 * STATS_DAY_MS }] }), 'viralSignupRate').status).toBe('unknown');
  });
  it('new users in 7 days and 10 ratings by day 2', () => {
    const users = [{ uid: 'a', createdAt: NOW - STATS_DAY_MS * 10 }, { uid: 'b', createdAt: NOW - STATS_DAY_MS * 10 }, { uid: 'c', createdAt: NOW - STATS_DAY_MS }];
    const reviews = Array.from({ length: 10 }, (_, i) => ({ userId: 'a', landmarkId: `l${i}`, ratedAt: users[0].createdAt + 1000 + i }));
    const ms = run({ users, reviews });
    expect(byId(ms, 'newUsersPerWeek').value).toBe(1);
    const q = byId(ms, 'tenRatingsByDay2');
    expect(q.value).toBe(50); // a yes, b no; c too young
    expect(q.n).toBe(2);
    expect(byId(run({}), 'newUsersPerWeek').status).toBe('unknown');
  });
});

describe('taste score average', () => {
  it('uses each user’s latest snapshot, with the baseline next to it', () => {
    const h = (userId, at, score, baselineScore) => ({ userId, at, score, baselineScore, ratingsCount: 10 });
    const m = byId(run({ tasteHistory: [h('a', 1, 50, 40), h('a', 2, 90, 60), h('b', 5, 70, 50), h('c', 3, null, null)] }), 'tasteScoreAvg');
    expect(m.value).toBe(80);
    expect(m.baseline.value).toBe(55);
    expect(m.status).toBe('met');
    expect(byId(run({ tasteHistory: [h('a', 1, 60, 40)] }), 'tasteScoreAvg').status).toBe('missed');
    expect(byId(run({}), 'tasteScoreAvg').status).toBe('unknown');
  });
});

describe('metrics for the Horowitz Andreesen Academy tab', () => {
  const U = (uid, createdDay) => ({ uid, createdAt: day(createdDay) });
  it('Day 7 retention counts users who opened the app on day 7', () => {
    const ds = { users: [U('a', 1), U('b', 1)], openDays: [{ uid: 'a', date: dateUtc(day(1)) }, { uid: 'a', date: dateUtc(day(8)) }, { uid: 'b', date: dateUtc(day(1)) }] };
    const m = byId(run(ds), 'retentionD7');
    expect(m).toMatchObject({ value: 50, n: 2, status: 'info' });
  });
  it('ratings per active user per week: last 7 days only', () => {
    const t = NOW - STATS_DAY_MS;
    const ds = {
      openDays: [{ uid: 'a', date: dateUtc(t) }],
      reviews: [
        { userId: 'a', landmarkId: 'x', updatedAt: t },
        { userId: 'a', landmarkId: 'y', updatedAt: t },
        { userId: 'b', landmarkId: 'z', updatedAt: t },
        { userId: 'a', landmarkId: 'old', updatedAt: NOW - 30 * STATS_DAY_MS },
      ],
    };
    expect(byId(run(ds), 'ratingsPerActiveUserWeek')).toMatchObject({ value: 1.5, n: 2 });
    expect(byId(run({}), 'ratingsPerActiveUserWeek').value).toBeNull();
  });
  it('weekly users: active and new people per 7-day window, newest last', () => {
    const t = (daysAgo) => NOW - daysAgo * STATS_DAY_MS;
    const ds = {
      users: [{ uid: 'a', createdAt: t(2) }, { uid: 'b', createdAt: t(9) }, { uid: 'c', createdAt: t(40) }],
      openDays: [{ uid: 'a', date: dateUtc(t(1)) }, { uid: 'b', date: dateUtc(t(1)) }, { uid: 'b', date: dateUtc(t(8)) }, { uid: 'c', date: dateUtc(t(30)) }],
      reviews: [{ userId: 'c', landmarkId: 'x', updatedAt: t(3) }],
    };
    const m = byId(run(ds), 'weeklyUsers');
    expect(m.weekly).toHaveLength(6);
    expect(m.weekly[5]).toMatchObject({ active: 3, newUsers: 1 }); // a, b opened; c rated
    expect(m.weekly[4]).toMatchObject({ active: 1, newUsers: 1 }); // b opened on day 8; b joined day 9
    expect(m).toMatchObject({ value: 3, newUsers: 1, status: 'info', n: 3 });
    expect(byId(run({}), 'weeklyUsers').status).toBe('unknown');
  });
});
