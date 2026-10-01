import { DISAGREEMENT_REASONS } from './maprConstants.js';
import { buildPredictions } from './tasteScore.js';
import {
  STATS_DAY_MS,
  STATS_MIN_GROUP,
  STUDY_ACCURACY_AT,
  STUDY_ACCURACY_AT_TOLERANCE,
  STUDY_FLAT_MAX_GAIN,
  STUDY_FLAT_SNAPSHOTS,
  STUDY_MIN_CORRELATION_USERS,
  STUDY_RETURN_DAYS,
  STUDY_SERIES_DAYS,
  STUDY_THRESHOLDS,
} from './statsConstants.js';
import { addDays, dateUtc, mean, median, msOf, openDayTrackingStart, ratingTime, round1, startOfDayMs, TIER_LEVEL } from './adminStats.js';

// The long study, as pure functions over the same dataset as adminStats.js.
// Output is TOTALS only: counts, averages, medians, shares. No user ids.

const TAP_LEVEL = { yes: 'positive', unsure: 'neutral', no: 'negative' };

function quantiles(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return { n: 0, min: null, p25: null, median: null, p75: null, max: null };
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
  return { n: s.length, min: round1(s[0]), p25: round1(at(0.25)), median: round1(median(s)), p75: round1(at(0.75)), max: round1(s[s.length - 1]) };
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Per-user snapshots, oldest first, with a numeric ratingsCount.
function snapshotsByUser(ds) {
  const m = groupBy(
    (ds.tasteHistory || []).filter((h) => h?.userId && Number.isFinite(msOf(h.at))).map((h) => ({ ...h, at: msOf(h.at) })),
    'userId',
  );
  for (const list of m.values()) list.sort((a, b) => a.at - b.at);
  return m;
}

const accuracy = (preds) => ({
  predictions: preds.length,
  accuracyPct: preds.length ? round1((preds.reduce((s, p) => s + p.credit, 0) / preds.length) * 100) : null,
});

// Every user's predictions (buildPredictions), each tagged with where it was.
function allPredictions(ds, { rowFilter = () => true, mapRow = (r) => r } = {}) {
  const rows = groupBy((ds.recommendationLog || []).filter(rowFilter).map(mapRow), 'userId');
  const places = groupBy(ds.placeScores || [], 'userId');
  const out = [];
  for (const [uid, userRows] of rows) {
    const userPlaces = places.get(uid) || [];
    const byId = new Map(userPlaces.map((p) => [p.landmarkId, p]));
    for (const p of buildPredictions({ rows: userRows, places: userPlaces })) {
      const place = byId.get(p.landmarkId);
      out.push({ ...p, uid, region: place?.region || null, categories: Array.isArray(place?.categories) ? place.categories : [] });
    }
  }
  return out;
}

// A breakdown by a label, hiding groups with fewer than STATS_MIN_GROUP users.
function breakdown(preds, labelsOf) {
  const groups = new Map();
  for (const p of preds) {
    for (const label of labelsOf(p)) {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(p);
    }
  }
  const rows = [];
  let hidden = 0;
  for (const [label, list] of groups) {
    if (new Set(list.map((p) => p.uid)).size < STATS_MIN_GROUP) {
      hidden += 1;
      continue;
    }
    rows.push({ label, ...accuracy(list) });
  }
  rows.sort((a, b) => b.predictions - a.predictions || String(a.label).localeCompare(String(b.label)));
  return { rows, hiddenGroups: hidden };
}

function reachThreshold(snaps, createdBy, threshold) {
  let reached = 0;
  const ratings = [];
  const days = [];
  for (const [uid, list] of snaps) {
    const hit = list.find((h) => Number.isFinite(h.score) && h.score >= threshold);
    if (!hit) continue;
    reached += 1;
    if (Number.isFinite(hit.ratingsCount)) ratings.push(hit.ratingsCount);
    const made = createdBy.get(uid);
    if (made != null) days.push((hit.at - made) / STATS_DAY_MS);
  }
  return { threshold, usersWithHistory: snaps.size, reached, ratingsToReach: quantiles(ratings), daysToReach: quantiles(days) };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function computeStudy(ds, now = Date.now()) {
  const snaps = snapshotsByUser(ds);
  const createdBy = new Map((ds.users || []).filter((u) => u?.createdAt != null).map((u) => [u.uid, u.createdAt]));
  const latestOf = (list) => list[list.length - 1];

  // Accuracy across all users (latest score each).
  const latestScores = [...snaps.values()].map(latestOf).filter((h) => Number.isFinite(h.score)).map((h) => h.score);
  const sortedScores = [...latestScores].sort((a, b) => a - b);
  const accuracyAll = {
    users: latestScores.length,
    average: round1(mean(latestScores)),
    best: sortedScores.length ? sortedScores[sortedScores.length - 1] : null,
    worst: sortedScores.length ? sortedScores[0] : null,
    median: round1(median(latestScores)),
  };

  // Mapr vs baseline, a point per day: each user's newest snapshot as of that day.
  const series = [];
  const todayMs = startOfDayMs(dateUtc(now));
  for (let i = STUDY_SERIES_DAYS - 1; i >= 0; i -= 1) {
    const dayMs = todayMs - i * STATS_DAY_MS;
    const endMs = dayMs + STATS_DAY_MS;
    const scores = [];
    const bases = [];
    for (const list of snaps.values()) {
      let h = null;
      for (const x of list) {
        if (x.at < endMs) h = x;
        else break;
      }
      if (!h || !Number.isFinite(h.score)) continue;
      scores.push(h.score);
      if (Number.isFinite(h.baselineScore)) bases.push(h.baselineScore);
    }
    if (scores.length) series.push({ date: dateUtc(dayMs), mapr: round1(mean(scores)), baseline: round1(mean(bases)), users: scores.length });
  }

  // Accuracy at N ratings: the snapshot closest to N ratings, within a tolerance.
  const accuracyAtRatings = STUDY_ACCURACY_AT.map((n) => {
    const tol = Math.max(2, Math.round(n * STUDY_ACCURACY_AT_TOLERANCE));
    const mapr = [];
    const base = [];
    for (const list of snaps.values()) {
      let best = null;
      for (const h of list) {
        if (!Number.isFinite(h.score) || !Number.isFinite(h.ratingsCount)) continue;
        const d = Math.abs(h.ratingsCount - n);
        if (d <= tol && (!best || d < best.d)) best = { d, h };
      }
      if (best) {
        mapr.push(best.h.score);
        if (Number.isFinite(best.h.baselineScore)) base.push(best.h.baselineScore);
      }
    }
    return { ratings: n, users: mapr.length, mapr: round1(mean(mapr)), baseline: round1(mean(base)) };
  });

  // Predictions-based breakdowns.
  const preds = allPredictions(ds);
  const byCategory = breakdown(preds, (p) => p.categories);
  const byCity = breakdown(preds, (p) => (p.region ? [p.region] : []));
  const asSolo = (r) => ({ ...r, requestFor: 'solo' });
  const justMe = accuracy(allPredictions(ds, { rowFilter: (r) => r.requestFor !== 'group' }));
  const group = accuracy(allPredictions(ds, { rowFilter: (r) => r.requestFor === 'group', mapRow: asSolo }));
  const usual = accuracy(allPredictions(ds, { rowFilter: (r) => r.pickType === 'usual' }));
  const something = accuracy(allPredictions(ds, { rowFilter: (r) => r.pickType === 'new' }));
  const big = preds.filter((p) => p.gap === 2 && !p.halfMiss).length;
  const bigMisses = { predictions: preds.length, bigMisses: big, sharePct: preds.length ? round1((big / preds.length) * 100) : null };

  // What happened? answers.
  const reasons = Object.fromEntries(DISAGREEMENT_REASONS.map((r) => [r, 0]));
  let reasonTotal = 0;
  for (const r of ds.reviews || []) {
    const reason = r?.disagreement?.reason;
    if (reason && reason in reasons) {
      reasons[reason] += 1;
      reasonTotal += 1;
    }
  }

  // Tap vs visit: a tap, then a LATER rating of the same place by the same user.
  const ratingBy = new Map();
  for (const r of ds.reviews || []) {
    const t = ratingTime(r);
    if (r?.userId && t != null && TIER_LEVEL[r.ratingTier]) ratingBy.set(`${r.userId}|${r.landmarkId}`, { level: TIER_LEVEL[r.ratingTier], at: t });
  }
  const tv = { pairs: 0, agree: 0, byTap: { positive: { pairs: 0, agree: 0 }, neutral: { pairs: 0, agree: 0 }, negative: { pairs: 0, agree: 0 } } };
  for (const f of ds.pickFeedback || []) {
    const level = TAP_LEVEL[f?.verdict];
    const tapAt = msOf(f?.at);
    const rating = ratingBy.get(`${f?.userId}|${f?.landmarkId}`);
    if (!level || tapAt == null || !rating || rating.at <= tapAt) continue;
    tv.pairs += 1;
    tv.byTap[level].pairs += 1;
    if (rating.level === level) {
      tv.agree += 1;
      tv.byTap[level].agree += 1;
    }
  }
  const tapVsVisit = { ...tv, agreePct: tv.pairs ? round1((tv.agree / tv.pairs) * 100) : null };

  // Users whose score stopped rising.
  let measurable = 0;
  let flat = 0;
  for (const list of snaps.values()) {
    const scored = list.filter((h) => Number.isFinite(h.score));
    if (scored.length < STUDY_FLAT_SNAPSHOTS) continue;
    measurable += 1;
    if (latestOf(scored).score - scored[scored.length - STUDY_FLAT_SNAPSHOTS].score <= STUDY_FLAT_MAX_GAIN) flat += 1;
  }
  const stalled = {
    snapshots: STUDY_FLAT_SNAPSHOTS,
    users: measurable,
    stalled: flat,
    sharePct: measurable ? round1((flat / measurable) * 100) : null,
  };

  // Score vs coming back: still opening the app on day N or later.
  const trackStart = openDayTrackingStart(ds);
  const opens = groupBy(ds.openDays || [], 'uid');
  const scoreVsReturn = STUDY_RETURN_DAYS.map((n) => {
    const xs = [];
    const ys = [];
    if (trackStart) {
      for (const [uid, list] of snaps) {
        const made = createdBy.get(uid);
        const h = latestOf(list);
        if (made == null || !Number.isFinite(h.score) || made < startOfDayMs(trackStart) || made + n * STATS_DAY_MS > now) continue;
        const from = addDays(dateUtc(made), n);
        xs.push(h.score);
        ys.push((opens.get(uid) || []).some((o) => o.date >= from) ? 1 : 0);
      }
    }
    const back = xs.filter((_, i) => ys[i] === 1);
    const gone = xs.filter((_, i) => ys[i] === 0);
    const enough = xs.length >= STUDY_MIN_CORRELATION_USERS;
    const r = enough ? pearson(xs, ys) : null;
    return {
      day: n,
      users: xs.length,
      returned: back.length,
      avgScoreReturned: round1(mean(back)),
      avgScoreNotReturned: round1(mean(gone)),
      correlation: r == null ? null : Math.round(r * 100) / 100,
    };
  });

  return {
    accuracyAll,
    reach: STUDY_THRESHOLDS.map((t) => reachThreshold(snaps, createdBy, t)),
    series,
    accuracyAtRatings,
    byCategory,
    byCity,
    audience: { justMe, group },
    pickType: { usual, something },
    bigMisses,
    whatHappened: { total: reasonTotal, counts: reasons },
    tapVsVisit,
    stalled,
    scoreVsReturn,
  };
}
