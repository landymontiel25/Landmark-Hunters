import { computeMatchRate, gatherMatchRateInputs } from '../matchRate.js';
import { AB, ALERTS, EXPLORATION, METRICS, TARGETS } from './config.js';
import { isStagnating } from './exploration.js';

// Mapr Phase 1 daily metrics, pure over plain rows (api/_lib/statsData.js
// shapes, times in ms). Totals only: never a uid, name or location.
//
// Each shown pick (recommendation_log row, not a test row) gets a
// user_action from what the same user did with the same place within
// METRICS.reactionWindowDays of the showing:
//   rated   a rating      visited  a real check-in
//   viewed  a pick tap     skipped  nothing
// (most advanced wins). Dwell time is not tracked by the app (it records
// arrivals, not departures), so it is reported as null.

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_STARS = { 'highly-recommend': 5, 'worth-trying': 3, 'probably-skip': 1 };
const dateUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (date) => Date.parse(`${date}T00:00:00.000Z`);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const ratio = (a, b) => (b > 0 ? a / b : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratingAt = (r) => r.ratedAt ?? r.updatedAt ?? r.createdAt ?? null;

export function percentile(xs, p) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

// ---- Statistics ---------------------------------------------------------------

// Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, error < 1.5e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// Two-proportion z-test, control (a) vs treatment (b). CI is for b - a.
export function twoProportionTest(xa, na, xb, nb, alpha = AB.alpha) {
  if (!(na > 0 && nb > 0)) return { pA: ratio(xa, na), pB: ratio(xb, nb), diff: null, lift: null, z: null, pValue: null, ci: null, significant: false };
  const pA = xa / na;
  const pB = xb / nb;
  const pooled = (xa + xb) / (na + nb);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
  const z = se > 0 ? (pB - pA) / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  const zCrit = 1.959963984540054; // 95%
  const seDiff = Math.sqrt((pA * (1 - pA)) / na + (pB * (1 - pB)) / nb);
  const diff = pB - pA;
  return {
    pA: r4(pA),
    pB: r4(pB),
    diff: r4(diff),
    lift: pA > 0 ? r4(diff / pA) : null,
    z: r4(z),
    pValue: r4(pValue),
    ci: [r4(diff - zCrit * seDiff), r4(diff + zCrit * seDiff)],
    significant: pValue < alpha,
  };
}

// ---- Joining shown rows to what happened ----------------------------------------

function indexBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyFn(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

const pairKey = (r) => (r?.userId && r?.landmarkId ? `${r.userId}|${r.landmarkId}` : null);

// Shown rows with user_action, rating and the repeat flag.
export function annotateShown(ds, windowDays = METRICS.reactionWindowDays) {
  const win = windowDays * DAY_MS;
  const taps = indexBy(ds.pickFeedback, pairKey);
  const reviews = indexBy(ds.reviews, pairKey);
  const visits = indexBy((ds.checkins || []).filter((c) => c.ratingOnly !== true && c.landmarkId), pairKey);
  const within = (t, from) => Number.isFinite(t) && t >= from && t <= from + win;
  return (ds.recommendationLog || [])
    .filter((r) => r && r.isTest !== true && r.setId && r.userId && r.landmarkId && Number.isFinite(r.shownAt))
    .map((r) => {
      const k = pairKey(r);
      const tapped = (taps.get(k) || []).some((t) => within(t.at, r.shownAt));
      const review = (reviews.get(k) || []).filter((x) => within(ratingAt(x), r.shownAt)).sort((a, b) => ratingAt(b) - ratingAt(a))[0];
      const priorVisits = (visits.get(k) || []).filter((c) => Number.isFinite(c.createdAt) && c.createdAt < r.shownAt);
      const visited = (visits.get(k) || []).some((c) => within(c.createdAt, r.shownAt));
      const stars = review ? TIER_STARS[review.ratingTier] || null : null;
      const action = review ? 'rated' : visited ? 'visited' : tapped ? 'viewed' : 'skipped';
      return { ...r, action, clicked: action !== 'skipped', visited, rating: stars, repeat: priorVisits.length > 0 || r.revisit === true, dwellSeconds: null };
    });
}

// ---- Daily report -----------------------------------------------------------------

function summarizeRows(rows) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const rated = rows.filter((r) => r.rating != null);
  return {
    shown: n,
    clicked: count((r) => r.clicked),
    ctr: r4(ratio(count((r) => r.clicked), n)),
    skipRate: r4(ratio(count((r) => r.action === 'skipped'), n)),
    repeatRate: r4(ratio(count((r) => r.repeat), n)),
    visitLoveRate: r4(ratio(count((r) => r.visited && r.rating >= 4), n)),
    rated: rated.length,
    avgPickRating: r4(mean(rated.map((r) => r.rating))),
    rating4plusShare: r4(ratio(rated.filter((r) => r.rating >= 4).length, rated.length)),
    actions: { viewed: count((r) => r.action === 'viewed'), visited: count((r) => r.action === 'visited'), rated: count((r) => r.action === 'rated'), skipped: count((r) => r.action === 'skipped') },
  };
}

// Users (in `ids`) who checked in at the same place twice in [from, to).
function revisitRate(ds, ids, from, to) {
  const per = new Map();
  for (const c of ds.checkins || []) {
    if (c.ratingOnly === true || !ids.has(c.userId) || !(c.createdAt >= from && c.createdAt < to)) continue;
    const k = `${c.userId}|${c.landmarkId}`;
    per.set(k, (per.get(k) || 0) + 1);
  }
  const users = new Set([...per.entries()].filter(([, n]) => n >= 2).map(([k]) => k.split('|')[0]));
  return r4(ratio(users.size, ids.size));
}

function experimentReport(name, annotated, ds, date) {
  const rows = annotated.filter((r) => r.variants?.[name]);
  const firstTreatment = rows.filter((r) => r.variants[name] === 'treatment').reduce((m, r) => Math.min(m, r.shownAt), Infinity);
  const started = Number.isFinite(firstTreatment) ? dateUtc(firstTreatment) : null;
  const end = dayStart(date) + DAY_MS;
  const inTest = rows.filter((r) => Number.isFinite(firstTreatment) && r.shownAt >= firstTreatment && r.shownAt < end);
  const arms = {};
  for (const v of ['control', 'treatment']) {
    const armRows = inTest.filter((r) => r.variants[name] === v);
    const ids = new Set(armRows.map((r) => r.userId));
    const latencies = setLatencies(armRows);
    arms[v] = { ...summarizeRows(armRows), users: ids.size, revisitRate: revisitRate(ds, ids, firstTreatment, end), latencyP99Ms: percentile(latencies, 99), explorationShare: r4(ratio(armRows.filter((r) => r.explore).length, armRows.length)) };
  }
  const c = arms.control;
  const t = arms.treatment;
  const ctrTest = twoProportionTest(c.clicked, c.shown, t.clicked, t.shown);
  const days = started ? Math.floor((end - dayStart(started)) / DAY_MS) : 0;
  const guardrails = {
    skipRate: t.skipRate == null || t.skipRate < 0.3,
    repeatRate: t.repeatRate == null || t.repeatRate < 0.25,
    latencyP99: t.latencyP99Ms == null || t.latencyP99Ms < ALERTS.latencyP99Ms,
  };
  let decision = 'collecting';
  if (!started) decision = 'not-started';
  else if (days >= AB.minDays && ctrTest.significant) decision = ctrTest.diff > 0 && Object.values(guardrails).every(Boolean) ? 'promote' : 'revert';
  else if (days >= AB.maxDays) decision = 'neutral-investigate';
  return { started, days, arms, ctr: ctrTest, guardrails, decision, note: 'Unit is the shown pick; picks from one user are not independent, so treat p-values near the line with care.' };
}

// Per built set, one latency value.
function setLatencies(rows) {
  const by = new Map();
  for (const r of rows) if (Number.isFinite(r.rankLatencyMs) && r.setId) by.set(r.setId, r.rankLatencyMs);
  return [...by.values()];
}

// The report for one UTC day. `ds` = loadStatsData output plus model info:
//   ds.models = { ncf: { trainedAt, evaluation }, similarity: { computedAt, ms } }
export function computeDailyReport(ds, { date = dateUtc(Date.now() - DAY_MS), now = Date.now() } = {}) {
  const from = dayStart(date);
  const to = from + DAY_MS;
  const annotated = annotateShown(ds);
  const today = annotated.filter((r) => r.shownAt >= from && r.shownAt < to);
  const base = summarizeRows(today);
  const activeUsers = new Set(today.map((r) => r.userId));

  // Reaction-based match rate (the long-standing Mapr Match Rate), on the
  // picks shown this day.
  const mrInputs = gatherMatchRateInputs({ recommendationLog: (ds.recommendationLog || []).filter((r) => r.shownAt >= from && r.shownAt < to), pickFeedback: ds.pickFeedback, reviews: ds.reviews });
  const mr = computeMatchRate(mrInputs).overall;

  const ratingsToday = (ds.reviews || []).filter((r) => ratingAt(r) >= from && ratingAt(r) < to && TIER_STARS[r.ratingTier]);
  const distances = today.map((r) => r.distanceKm).filter(Number.isFinite);
  const boosts = today.map((r) => r.collabBoost).filter(Number.isFinite);
  const [b1, b2] = METRICS.boostBuckets;
  const explored = today.filter((r) => r.explore === true);
  const latencies = setLatencies(today);
  const fallbackCounts = {};
  for (const r of today) for (const f of r.fallbacks || []) fallbackCounts[f] = (fallbackCounts[f] || 0) + 1;

  // Weekly novelty: of picks shown in the last 7 days, the share that the user
  // had never been shown before.
  const weekFrom = to - 7 * DAY_MS;
  const firstShown = new Map();
  for (const r of annotated) {
    const k = `${r.userId}|${r.region || ''}/${r.landmarkId}`;
    if (!firstShown.has(k) || r.shownAt < firstShown.get(k)) firstShown.set(k, r.shownAt);
  }
  const week = annotated.filter((r) => r.shownAt >= weekFrom && r.shownAt < to);
  const novelWeek = week.filter((r) => firstShown.get(`${r.userId}|${r.region || ''}/${r.landmarkId}`) === r.shownAt);
  const uniquePerUser = new Map();
  for (const r of week) {
    if (!uniquePerUser.has(r.userId)) uniquePerUser.set(r.userId, new Set());
    uniquePerUser.get(r.userId).add(r.landmarkId);
  }

  // Stagnation over users active in the last 7 days (an app open).
  const recentOpen = new Set((ds.openDays || []).filter((o) => o.date >= dateUtc(weekFrom) && o.date < dateUtc(to)).map((o) => o.uid));
  const states = [...recentOpen].map((uid) => stagnationState(ds, uid, to));
  const stagnating = states.filter((s) => isStagnating(s));

  const report = {
    date,
    matured: now - to >= METRICS.reactionWindowDays * DAY_MS,
    totals: { shown: base.shown, users: activeUsers.size, sets: new Set(today.map((r) => r.setId)).size },
    matchRate: r4(mr.matchRate),
    eligibleMatchRate: r4(mr.eligibleMatchRate),
    visitLoveRate: base.visitLoveRate,
    skipRate: base.skipRate,
    repeatRate: base.repeatRate,
    ctr: base.ctr,
    actions: base.actions,
    avgRating: r4(mean(ratingsToday.map((r) => TIER_STARS[r.ratingTier]))),
    ratingsGiven: ratingsToday.length,
    avgPickRating: base.avgPickRating,
    rating4plusShare: base.rating4plusShare,
    dwellTimeSeconds: null,
    recommendationsPerUser: r4(ratio(base.shown, activeUsers.size)),
    distance: {
      n: distances.length,
      p25: percentile(distances, 25),
      p50: percentile(distances, 50),
      p75: percentile(distances, 75),
      p90: percentile(distances, 90),
      within1_5km: r4(ratio(distances.filter((d) => d <= METRICS.nearKm).length, distances.length)),
      within3km: r4(ratio(distances.filter((d) => d <= METRICS.midKm).length, distances.length)),
    },
    boost: {
      n: boosts.length,
      zero: r4(ratio(boosts.filter((b) => b === 0).length, boosts.length)),
      upTo5: r4(ratio(boosts.filter((b) => b > 0 && b <= b1).length, boosts.length)),
      upTo10: r4(ratio(boosts.filter((b) => b > b1 && b <= b2).length, boosts.length)),
      over10: r4(ratio(boosts.filter((b) => b > b2).length, boosts.length)),
      skipRateBoosted: summarizeRows(today.filter((r) => r.collabBoost > 0)).skipRate,
      skipRateUnboosted: summarizeRows(today.filter((r) => !(r.collabBoost > 0))).skipRate,
    },
    exploration: {
      share: r4(ratio(explored.length, today.length)),
      avgNovelty: r4(mean(explored.map((r) => r.noveltyScore).filter(Number.isFinite))),
      skipRate: summarizeRows(explored).skipRate,
      avgRating: summarizeRows(explored).avgPickRating,
      avgEpsilon: r4(mean(today.map((r) => r.epsilon).filter(Number.isFinite))),
    },
    novelty: {
      weeklyNewShare: r4(ratio(novelWeek.length, week.length)),
      uniqueLandmarksPerUserWeek: r4(mean([...uniquePerUser.values()].map((s) => s.size))),
    },
    stagnation: { activeUsers: states.length, stagnating: stagnating.length, share: r4(ratio(stagnating.length, states.length)), lowRatingsShare: r4(ratio(states.filter((s) => s.ratings7d < EXPLORATION.stagnantRatings7d).length, states.length)) },
    latency: { sets: latencies.length, p50Ms: percentile(latencies, 50), p99Ms: percentile(latencies, 99) },
    fallbacks: fallbackCounts,
    models: modelHealth(ds.models, now),
    experiments: { ncf: experimentReport('ncf', annotated, ds, date), exploration: experimentReport('exploration', annotated, ds, date) },
  };
  report.alerts = alertsFor(report);
  report.targets = targetStatus(report);
  return report;
}

function stagnationState(ds, uid, to) {
  const from = to - 7 * DAY_MS;
  const ratings7d = (ds.reviews || []).filter((r) => r.userId === uid && ratingAt(r) >= from && ratingAt(r) < to).length;
  const visits7d = new Set((ds.checkins || []).filter((c) => c.userId === uid && c.ratingOnly !== true && c.createdAt >= from && c.createdAt < to).map((c) => c.landmarkId)).size;
  return { userId: uid, ratings7d, visits7d };
}

// Per-user stagnation flags for the user-model docs (never in the report).
export function stagnatingUserIds(ds, now = Date.now()) {
  const weekFrom = now - 7 * DAY_MS;
  const active = new Set((ds.openDays || []).filter((o) => o.date >= dateUtc(weekFrom)).map((o) => o.uid));
  return [...active].filter((uid) => isStagnating(stagnationState(ds, uid, now)));
}

function modelHealth(models, now) {
  const age = (t) => (Number.isFinite(t) ? r4((now - t) / DAY_MS) : null);
  return {
    ncfTrainedDaysAgo: age(models?.ncf?.trainedAt),
    ncfTestAccuracy: r4(models?.ncf?.evaluation?.testAccuracy),
    ncfTrainMs: models?.ncf?.evaluation?.trainMs ?? null,
    ncfVersion: models?.ncf?.version ?? null,
    similarityComputedDaysAgo: age(models?.similarity?.computedAt),
    similarityComputeMs: models?.similarity?.ms ?? null,
  };
}

export function alertsFor(r) {
  const out = [];
  if (r.latency.p99Ms != null && r.latency.p99Ms > ALERTS.latencyP99Ms) out.push(`Latency p99 ${r.latency.p99Ms} ms is over ${ALERTS.latencyP99Ms} ms.`);
  if (r.skipRate != null && r.skipRate > ALERTS.skipRate) out.push(`Skip rate ${pct(r.skipRate)} is over ${pct(ALERTS.skipRate)}.`);
  if (r.exploration.skipRate != null && r.exploration.skipRate > ALERTS.exploreSkipRate) out.push(`Skip rate on exploration picks ${pct(r.exploration.skipRate)} is over ${pct(ALERTS.exploreSkipRate)}.`);
  if (r.repeatRate != null && r.repeatRate > ALERTS.repeatRate) out.push(`Repeat rate ${pct(r.repeatRate)} is over ${pct(ALERTS.repeatRate)}.`);
  if (r.stagnation.share != null && r.stagnation.share > ALERTS.stagnatingShare) out.push(`${pct(r.stagnation.share)} of active users are stagnating (over ${pct(ALERTS.stagnatingShare)}).`);
  const ncfFails = Object.entries(r.fallbacks).filter(([k]) => k.startsWith('ncf-') && k !== 'ncf-no-user').reduce((n, [, v]) => n + v, 0);
  if (ncfFails > 0) out.push(`NCF fell back on ${ncfFails} shown picks (${Object.keys(r.fallbacks).filter((k) => k.startsWith('ncf-')).join(', ')}).`);
  if (r.models.ncfTrainedDaysAgo == null || r.models.ncfTrainedDaysAgo > ALERTS.trainingMaxAgeDays) out.push('The weekly NCF training has not completed in the last 8 days.');
  if (r.models.similarityComputedDaysAgo == null || r.models.similarityComputedDaysAgo > ALERTS.trainingMaxAgeDays) out.push('The weekly similarity matrix has not been computed in the last 8 days.');
  return out;
}

function targetStatus(r) {
  const judge = (v, ok) => (v == null ? 'unknown' : ok(v) ? 'met' : 'missed');
  return {
    matchRate: judge(r.matchRate, (v) => v >= TARGETS.matchRate),
    skipRate: judge(r.skipRate, (v) => v < TARGETS.skipRate),
    repeatRate: judge(r.repeatRate, (v) => v < TARGETS.repeatRate),
    avgRating: judge(r.avgRating, (v) => v >= TARGETS.avgRating),
    novelty: judge(r.novelty.weeklyNewShare, (v) => v >= TARGETS.novelty),
    near1_5km: judge(r.distance.within1_5km, (v) => v >= TARGETS.near1_5km),
    near3km: judge(r.distance.within3km, (v) => v >= TARGETS.near3km),
    latency: judge(r.latency.p99Ms, (v) => v < TARGETS.latencyP99Ms),
  };
}

const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);

// ---- Exports --------------------------------------------------------------------

// Flat key,value CSV of one report (nested keys joined with dots).
export function reportToCsv(report) {
  const rows = [];
  const walk = (v, path) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    else rows.push([path, Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v)]);
  };
  walk(report, '');
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['metric,value', ...rows.map(([k, v]) => `${esc(k)},${esc(v)}`)].join('\n');
}

// One line per metric across the trend (oldest first), for the CSV export
// and the Slack sparkline.
export function trendSeries(reports, pick) {
  return (reports || []).map((r) => ({ date: r.date, value: pick(r) }));
}

const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return values.map((x) => (Number.isFinite(x) ? SPARK[hi === lo ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)] : ' ')).join('');
}

// Slack message (mrkdwn) for one report and the trend before it.
export function slackMessage(report, trend = []) {
  const series = [...trend, report];
  const line = (label, value, pick) => `• ${label}: *${value}*  ${sparkline(series.map(pick))}`;
  const ab = (name) => {
    const e = report.experiments[name];
    if (!e.started) return `• ${name.toUpperCase()} A/B: not started`;
    return `• ${name.toUpperCase()} A/B day ${e.days}: CTR ${pct(e.ctr.pA)} → ${pct(e.ctr.pB)} (lift ${pct(e.ctr.lift)}, p=${e.ctr.pValue ?? 'n/a'}) → ${e.decision}`;
  };
  return [
    `*Mapr daily — ${report.date}*${report.matured ? '' : ' _(reactions still coming in)_'}`,
    line('Match rate', pct(report.matchRate), (r) => r.matchRate),
    line('Skip rate', pct(report.skipRate), (r) => r.skipRate),
    line('Repeat rate', pct(report.repeatRate), (r) => r.repeatRate),
    line('Avg rating', report.avgRating ?? 'n/a', (r) => r.avgRating),
    line('Novelty (7d)', pct(report.novelty.weeklyNewShare), (r) => r.novelty?.weeklyNewShare),
    line('Recs per user', report.recommendationsPerUser ?? 'n/a', (r) => r.recommendationsPerUser),
    `• Within 1.5 km: *${pct(report.distance.within1_5km)}*, within 3 km: *${pct(report.distance.within3km)}*`,
    `• Latency p99: *${report.latency.p99Ms ?? 'n/a'} ms*  • Exploration share: *${pct(report.exploration.share)}*`,
    ab('ncf'),
    ab('exploration'),
    report.alerts.length ? `:warning: ${report.alerts.join('\n:warning: ')}` : ':white_check_mark: No alerts',
  ].join('\n');
}
