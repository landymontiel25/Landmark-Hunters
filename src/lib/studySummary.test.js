import { describe, it, expect } from 'vitest';
import { computeStudy } from './studySummary';
import { STATS_DAY_MS } from './statsConstants';

const D0 = Date.parse('2026-09-01T00:00:00Z');
const day = (n) => D0 + n * STATS_DAY_MS;
const NOW = day(40);
const empty = { users: [], openDays: [], reviews: [], checkins: [], referrals: [], recommendationLog: [], pickFeedback: [], placeScores: [], tasteHistory: [] };
const study = (ds, now = NOW) => computeStudy({ ...empty, ...ds }, now);
const snap = (userId, d, score, baselineScore, ratingsCount) => ({ userId, at: day(d), score, baselineScore, ratingsCount });

describe('study: scores', () => {
  const tasteHistory = [
    snap('a', 1, 60, 50, 5),
    snap('a', 3, 82, 55, 10),
    snap('a', 5, 91, 55, 22),
    snap('b', 2, 40, 45, 5),
    snap('b', 6, 85, 50, 20),
    snap('c', 4, 30, 40, 11),
  ];
  const users = ['a', 'b', 'c'].map((uid) => ({ uid, createdAt: day(0) }));
  it('accuracy across users: average, best, worst, middle (latest score each)', () => {
    const s = study({ tasteHistory, users });
    expect(s.accuracyAll).toEqual({ users: 3, average: 68.7, best: 91, worst: 30, median: 85 });
  });
  it('time and ratings to reach 80% and 90%', () => {
    const s = study({ tasteHistory, users });
    const r80 = s.reach.find((r) => r.threshold === 80);
    expect(r80.reached).toBe(2);
    expect(r80.usersWithHistory).toBe(3);
    expect(r80.ratingsToReach.median).toBe(15); // a: 10, b: 20
    expect(r80.daysToReach.median).toBe(4.5); // a: day 3, b: day 6
    const r90 = s.reach.find((r) => r.threshold === 90);
    expect(r90.reached).toBe(1);
    expect(r90.ratingsToReach.median).toBe(22);
  });
  it('daily series: carries each user’s newest snapshot forward, Mapr vs baseline', () => {
    const s = study({ tasteHistory, users });
    const at = (d) => s.series.find((p) => p.date === new Date(day(d)).toISOString().slice(0, 10));
    expect(at(0)).toBeUndefined();
    expect(at(1)).toMatchObject({ mapr: 60, baseline: 50, users: 1 });
    expect(at(2)).toMatchObject({ mapr: 50, baseline: 47.5, users: 2 });
    expect(at(6)).toMatchObject({ mapr: 68.7, users: 3 });
  });
  it('accuracy at N ratings uses the snapshot nearest N within tolerance', () => {
    const s = study({ tasteHistory, users });
    const at = (n) => s.accuracyAtRatings.find((r) => r.ratings === n);
    expect(at(5)).toMatchObject({ users: 2, mapr: 50 }); // a 60, b 40
    expect(at(10)).toMatchObject({ users: 2 }); // a (10 -> 82), c (11 -> 30)
    expect(at(10).mapr).toBe(56);
    expect(at(100)).toMatchObject({ users: 0, mapr: null });
  });
  it('stopped rising: last N snapshots gained one point or less', () => {
    const hist = [
      ...[50, 60, 70, 80].map((sc, i) => snap('up', i + 1, sc, 40, 10 + i)),
      ...[70, 71, 70, 71].map((sc, i) => snap('flat', i + 1, sc, 40, 10 + i)),
      snap('new', 1, 50, 40, 5),
    ];
    const s = study({ tasteHistory: hist });
    expect(s.stalled).toMatchObject({ users: 2, stalled: 1, sharePct: 50 });
  });
  it('score vs coming back: correlation, hidden below the minimum number of users', () => {
    const openDays = [];
    const hist = [];
    const us = [];
    for (let i = 0; i < 6; i += 1) {
      const uid = `u${i}`;
      us.push({ uid, createdAt: day(2) });
      hist.push(snap(uid, 5, 20 + i * 15, 10, 10)); // scores 20..95
      if (i >= 3) openDays.push({ uid, date: new Date(day(2 + 8)).toISOString().slice(0, 10) }); // the high scorers came back after day 7
      openDays.push({ uid, date: new Date(day(2)).toISOString().slice(0, 10) });
    }
    const s = study({ users: us, tasteHistory: hist, openDays });
    const d7 = s.scoreVsReturn.find((r) => r.day === 7);
    expect(d7.users).toBe(6);
    expect(d7.returned).toBe(3);
    expect(d7.avgScoreReturned).toBeGreaterThan(d7.avgScoreNotReturned);
    expect(d7.correlation).toBeGreaterThan(0.8);
    const d30 = s.scoreVsReturn.find((r) => r.day === 30);
    expect(d30.users).toBe(6); // day 2 + 30 = day 32 <= now (day 40)
    expect(study({ users: us.slice(0, 2), tasteHistory: hist.slice(0, 2), openDays }).scoreVsReturn[0].correlation).toBeNull();
  });
});

describe('study: predictions', () => {
  // Each user answers `n` places after Mapr guessed; `ok` are hits, others are big misses.
  function userRows(uid, { n, ok, region = 'sf', cat = 'food', requestFor, pickType = null, start = 0 }) {
    const rows = [];
    const places = [];
    for (let i = 0; i < n; i += 1) {
      const id = `${uid}-${start + i}`;
      rows.push({ userId: uid, landmarkId: id, shownAt: day(1) + i, predicted: 'positive', requestFor, pickType });
      places.push({ userId: uid, landmarkId: id, region, categories: [cat], latestLevel: i < ok ? 'positive' : 'negative', latestAt: day(2) + i, ratingAt: day(0) });
    }
    return { rows, places };
  }
  const merge = (...parts) => ({ recommendationLog: parts.flatMap((p) => p.rows), placeScores: parts.flatMap((p) => p.places) });

  it('by category and city; groups with too few users are hidden', () => {
    const ds = merge(
      ...['a', 'b', 'c'].map((u) => userRows(u, { n: 4, ok: 3, region: 'sf', cat: 'food' })),
      userRows('d', { n: 4, ok: 0, region: 'nyc', cat: 'parks' })
    );
    const s = study(ds);
    expect(s.byCategory.rows).toEqual([{ label: 'food', predictions: 12, accuracyPct: 75 }]);
    expect(s.byCategory.hiddenGroups).toBe(1);
    expect(s.byCity.rows[0]).toMatchObject({ label: 'sf', accuracyPct: 75 });
    expect(JSON.stringify(s)).not.toContain('parks');
  });
  it('big misses: counts and share', () => {
    const s = study(merge(userRows('a', { n: 5, ok: 4 })));
    expect(s.bigMisses).toEqual({ predictions: 5, bigMisses: 1, sharePct: 20 });
  });
  it('Just me vs A group and usual vs something new', () => {
    const ds = merge(
      userRows('a', { n: 4, ok: 4, start: 0 }),
      userRows('a', { n: 4, ok: 0, requestFor: 'group', start: 10 }),
      userRows('b', { n: 2, ok: 2, pickType: 'usual', start: 0 }),
      userRows('b', { n: 2, ok: 0, pickType: 'new', start: 10 })
    );
    const s = study(ds);
    expect(s.audience.justMe.accuracyPct).toBeGreaterThan(s.audience.group.accuracyPct);
    expect(s.audience.group).toMatchObject({ predictions: 4, accuracyPct: 0 });
    expect(s.pickType.usual.accuracyPct).toBe(100);
    expect(s.pickType.something.accuracyPct).toBe(0);
  });
  it('"What happened?" counts and tap vs visit agreement', () => {
    const reviews = [
      { userId: 'a', landmarkId: 'x', ratingTier: 'probably-skip', ratedAt: day(5), disagreement: { reason: 'food' } },
      { userId: 'b', landmarkId: 'y', ratingTier: 'highly-recommend', ratedAt: day(5), disagreement: { reason: 'food' } },
      { userId: 'c', landmarkId: 'z', ratingTier: 'worth-trying', ratedAt: day(5), disagreement: { reason: 'one-off' } },
      { userId: 'd', landmarkId: 'w', ratingTier: 'worth-trying', ratedAt: day(5) },
    ];
    const pickFeedback = [
      { userId: 'a', landmarkId: 'x', verdict: 'yes', at: day(4) }, // yes, then skip: disagree
      { userId: 'b', landmarkId: 'y', verdict: 'yes', at: day(4) }, // agree
      { userId: 'c', landmarkId: 'z', verdict: 'yes', at: day(6) }, // tap AFTER rating: not counted
    ];
    const s = study({ reviews, pickFeedback });
    expect(s.whatHappened.total).toBe(3);
    expect(s.whatHappened.counts.food).toBe(2);
    expect(s.whatHappened.counts['one-off']).toBe(1);
    expect(s.tapVsVisit).toMatchObject({ pairs: 2, agree: 1, agreePct: 50 });
  });
  it('contains no per-user identifiers', () => {
    const ds = merge(...['uid-aaa', 'uid-bbb', 'uid-ccc'].map((u) => userRows(u, { n: 3, ok: 2 })));
    const json = JSON.stringify(study({ ...ds, tasteHistory: [snap('uid-aaa', 1, 50, 40, 5)], users: [{ uid: 'uid-aaa', createdAt: day(0) }] }));
    expect(json).not.toMatch(/uid-/);
  });
});
