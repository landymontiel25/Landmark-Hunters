import { computeMatchRate, gatherMatchRateInputs } from './matchRate.js';
import { MATCH_ELIGIBLE_MIN_RATINGS, MATCH_WEIGHT_RATING, MATCH_WEIGHT_TAP } from './maprConstants.js';
import { mostCommonAnswer } from './tasteScore.js';
import {
  APP_COHORT_START,
  GOAL_CHECKINS_PER_DAILY_USER,
  GOAL_FIRST_CHECKIN_HOURS,
  GOAL_MATCH_RATE_PCT,
  GOAL_RATINGS_PER_SESSION,
  GOAL_REFERRAL_COEFFICIENT,
  GOAL_RETENTION_D1_PCT,
  GOAL_RETENTION_D30_PCT,
  GOAL_TASTE_SCORE_AVG,
  GOAL_VIRAL_SIGNUP_PCT,
  GROWTH_GOALS,
  RATINGS_BY_DAY2,
  STATS_DAY_MS,
  STATS_MIN_SAMPLE,
  STATS_WEEK_MS,
  VIRAL_WINDOW_DAYS,
} from './statsConstants.js';

// The admin stats, as pure functions over plain arrays (no Firestore, no
// Firebase). Everything returned is TOTALS: counts, rates, medians. Never a
// uid, name, email or location.
//
// Dataset (all times in ms, already normalized by api/_lib/statsData.js):
//   users           [{ uid, createdAt }]
//   openDays        [{ uid, date }]                  date = the user's local YYYY-MM-DD
//   reviews         [{ userId, landmarkId, ratingTier, ratedAt, updatedAt, ... }]
//   checkins        [{ userId, createdAt, ratingOnly }]
//   referrals       [{ referrerUid, referredUid }]
//   recommendationLog / pickFeedback   raw rows (see matchRate.js)
//   placeScores     [{ userId, landmarkId, latestLevel, ... }]
//   tasteHistory    [{ userId, at, score, baselineScore, ratingsCount, ... }]

export const msOf = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
};

export const dateUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const startOfDayMs = (date) => Date.parse(`${date}T00:00:00.000Z`);
export const addDays = (date, n) => dateUtc(startOfDayMs(date) + n * STATS_DAY_MS);

export function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x));
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
};
export const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
export const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// When a rating was given: ratedAt (the first answer), else updatedAt.
export const ratingTime = (r) => msOf(r?.ratedAt) ?? msOf(r?.updatedAt) ?? msOf(r?.createdAt);

// status: 'met' | 'missed' | 'unknown' | 'info' (no goal)
function metric(m) {
  return {
    status: 'unknown',
    value: null,
    n: 0,
    baseline: null,
    note: '',
    headline: false,
    ...m,
  };
}
const judge = (value, ok) => (value == null ? 'unknown' : ok ? 'met' : 'missed');

function openDaySets(ds) {
  const byUser = new Map();
  for (const o of ds.openDays || []) {
    if (!o?.uid || !o.date) continue;
    if (!byUser.has(o.uid)) byUser.set(o.uid, new Set());
    byUser.get(o.uid).add(o.date);
  }
  return byUser;
}

export function openDayTrackingStart(ds) {
  let min = null;
  for (const o of ds.openDays || []) if (o?.date && (min === null || o.date < min)) min = o.date;
  return min;
}

export function cohortStartDate(ds) {
  if (APP_COHORT_START) return APP_COHORT_START;
  let min = null;
  for (const u of ds.users || []) if (u?.createdAt != null && (min === null || u.createdAt < min)) min = u.createdAt;
  return min == null ? null : dateUtc(min);
}

// Day-N retention: of users who signed up after open-day tracking began and
// whose day N is fully over, the share who opened the app ON day N. Day N is
// counted from the account's createdAt UTC date; open days are the user's
// local dates, so a late-evening signup can be a day off (approximation).
export function retention(ds, n, now = Date.now()) {
  const start = openDayTrackingStart(ds);
  if (!start) return { cohort: 0, returned: 0, pct: null };
  const startMs = startOfDayMs(start);
  const opens = openDaySets(ds);
  let cohort = 0;
  let returned = 0;
  for (const u of ds.users || []) {
    if (u?.createdAt == null || u.createdAt < startMs) continue;
    if (startOfDayMs(addDays(dateUtc(u.createdAt), n + 1)) > now) continue;
    cohort += 1;
    if (opens.get(u.uid)?.has(addDays(dateUtc(u.createdAt), n))) returned += 1;
  }
  return { cohort, returned, pct: cohort >= STATS_MIN_SAMPLE ? (returned / cohort) * 100 : null };
}

export function growthStats(ds, now = Date.now()) {
  const start = cohortStartDate(ds);
  const weeks = [];
  if (!start) return { start: null, weeks, currentWeek: null };
  const startMs = startOfDayMs(start);
  const weekOf = (ms) => Math.floor((ms - startMs) / STATS_WEEK_MS) + 1;
  const counts = new Map();
  for (const u of ds.users || []) {
    if (u?.createdAt == null || u.createdAt < startMs) continue;
    const w = weekOf(u.createdAt);
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const currentWeek = weekOf(now);
  for (let w = 1; w <= currentWeek; w += 1) weeks.push({ week: w, newUsers: counts.get(w) || 0 });
  return { start, weeks, currentWeek };
}

export const growthGoalFor = (week) => GROWTH_GOALS.find((g) => week >= g.fromWeek && week <= g.toWeek) || null;

const TIER_LEVEL = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };
export { TIER_LEVEL };

export function computeMetrics(ds, now = Date.now()) {
  const users = ds.users || [];
  const reviews = ds.reviews || [];
  const checkins = ds.checkins || [];
  const out = [];

  // ---- Mapr match rate (+ always-guess-usual-answer baseline) -------------
  const mr = computeMatchRate(
    gatherMatchRateInputs({ recommendationLog: ds.recommendationLog, pickFeedback: ds.pickFeedback, reviews }),
  );
  const eligible = mr.overall.eligibleUsers;
  const matchPct = mr.overall.eligibleMatchRate == null ? null : mr.overall.eligibleMatchRate * 100;
  // Baseline: on the same reactions of the same eligible users, the share that
  // equals the user's most common answer, i.e. how often "always guess their
  // usual answer" would have been right.
  const placesBy = new Map();
  for (const p of ds.placeScores || []) {
    if (!p?.userId) continue;
    if (!placesBy.has(p.userId)) placesBy.set(p.userId, []);
    placesBy.get(p.userId).push(p);
  }
  let bHit = 0;
  let bTot = 0;
  for (const [uid, s] of Object.entries(mr.perUser)) {
    if (!s.eligible) continue;
    const usual = mostCommonAnswer(placesBy.get(uid) || []);
    if (!usual) continue;
    bHit += s.taps[usual] * MATCH_WEIGHT_TAP + s.ratings[usual] * MATCH_WEIGHT_RATING;
    bTot += s.weightedTotal;
  }
  out.push(
    metric({
      id: 'matchRate',
      label: 'Mapr match rate',
      headline: true,
      value: round1(matchPct),
      unit: '%',
      goal: `above ${GOAL_MATCH_RATE_PCT}% at ${MATCH_ELIGIBLE_MIN_RATINGS} ratings`,
      status: judge(matchPct, matchPct > GOAL_MATCH_RATE_PCT),
      n: eligible,
      nLabel: 'users with 10+ ratings',
      baseline: bTot > 0 ? { value: round1((bHit / bTot) * 100), unit: '%', label: 'Always guessing each user’s usual answer' } : null,
      note: eligible ? '' : 'Needs users with 10+ ratings on Mapr picks.',
    }),
  );

  // ---- Growth ------------------------------------------------------------
  const g = growthStats(ds, now);
  const last = g.currentWeek == null ? null : g.currentWeek - 1;
  let growthPct = null;
  let goal = null;
  let growthNote = 'Needs two full weeks of sign-ups.';
  if (last != null && last >= 2) {
    const cur = g.weeks[last - 1].newUsers;
    const prev = g.weeks[last - 2].newUsers;
    goal = growthGoalFor(last);
    if (prev > 0) {
      growthPct = (cur / prev - 1) * 100;
      growthNote = `Week ${last}: ${cur} new vs ${prev} the week before.`;
    } else growthNote = `Week ${last - 1} had no sign-ups, so there is nothing to compare to.`;
  }
  out.push(
    metric({
      id: 'growth',
      label: 'Growth rate (week over week)',
      value: round1(growthPct),
      unit: '%',
      goal: goal ? `${goal.label} in week ${last}` : 'weeks 1-4: 100%+, 5-8: 50%, 9+: 20-30%',
      status: judge(growthPct, goal && growthPct >= goal.minPct),
      n: last != null && last >= 1 ? g.weeks[last - 1].newUsers : 0,
      nLabel: 'new users that week',
      note: growthNote,
    }),
  );

  // ---- Retention ----------------------------------------------------------
  const d1 = retention(ds, 1, now);
  const d30 = retention(ds, 30, now);
  const trackNote = openDayTrackingStart(ds) ? '' : 'Needs the daily open record (starts with this release).';
  out.push(
    metric({
      id: 'retentionD30',
      label: 'Day 30 retention',
      value: round1(d30.pct),
      unit: '%',
      goal: `above ${GOAL_RETENTION_D30_PCT}%`,
      status: judge(d30.pct, d30.pct > GOAL_RETENTION_D30_PCT),
      n: d30.cohort,
      nLabel: 'users old enough',
      note: trackNote || (d30.cohort ? '' : 'No one who signed up since tracking began has reached day 30 yet.'),
    }),
    metric({
      id: 'retentionD1',
      label: 'Day 1 retention',
      value: round1(d1.pct),
      unit: '%',
      goal: `above ${GOAL_RETENTION_D1_PCT}%`,
      status: judge(d1.pct, d1.pct > GOAL_RETENTION_D1_PCT),
      n: d1.cohort,
      nLabel: 'users old enough',
      note: trackNote || (d1.cohort ? '' : 'No one who signed up since tracking began has reached day 1 yet.'),
    }),
  );

  const d7 = retention(ds, 7, now);
  out.push(
    metric({
      id: 'retentionD7',
      label: 'Day 7 retention',
      value: round1(d7.pct),
      unit: '%',
      goal: '',
      status: d7.pct == null ? 'unknown' : 'info',
      n: d7.cohort,
      nLabel: 'users old enough',
      note: trackNote || (d7.cohort ? '' : 'No one who signed up since tracking began has reached day 7 yet.'),
    }),
  );

  // ---- Sessions: ratings and check-ins per open day -------------------------
  const opens = openDaySets(ds);
  let openCount = 0;
  for (const s of opens.values()) openCount += s.size;
  const onOpenDay = (uid, ms) => ms != null && opens.get(uid)?.has(dateUtc(ms));
  let ratingsOnOpen = 0;
  for (const r of reviews) if (r?.userId && onOpenDay(r.userId, ratingTime(r))) ratingsOnOpen += 1;
  const perSession = openCount ? ratingsOnOpen / openCount : null;
  const rps = GOAL_RATINGS_PER_SESSION;
  out.push(
    metric({
      id: 'ratingsPerSession',
      label: 'Ratings per session',
      value: round2(perSession),
      unit: '',
      goal: `${rps.min}-${rps.max}`,
      status: judge(perSession, perSession >= rps.min && perSession <= rps.max),
      n: openCount,
      nLabel: 'sessions',
      note: openCount
        ? 'A session = one day the app was opened; ratings counted on those days.'
        : 'No session data yet: needs the daily open record.',
    }),
  );
  let realOnOpen = 0;
  for (const c of checkins) if (c?.userId && c.ratingOnly !== true && onOpenDay(c.userId, c.createdAt)) realOnOpen += 1;
  const perDay = openCount ? realOnOpen / openCount : null;
  out.push(
    metric({
      id: 'checkinsPerDailyUser',
      label: 'Check-ins per daily user',
      value: round2(perDay),
      unit: '',
      goal: `${GOAL_CHECKINS_PER_DAILY_USER}+`,
      status: judge(perDay, perDay >= GOAL_CHECKINS_PER_DAILY_USER),
      n: openCount,
      nLabel: 'user-days',
      note: openCount ? 'Real check-ins (not rating-only) per user-day the app was opened.' : 'Needs the daily open record.',
    }),
  );

  // ---- Ratings per active user per week -------------------------------------
  const weekAgoMs = now - STATS_WEEK_MS;
  const weekAgoDate = dateUtc(weekAgoMs);
  // Same 7-day window as weeklyUsers below (the 7 dates after weekAgoDate).
  const activeWeek = new Set();
  for (const [uid, days] of opens) for (const d of days) if (d > weekAgoDate) activeWeek.add(uid);
  let ratingsWeek = 0;
  for (const r of reviews) {
    const t = ratingTime(r);
    if (r?.userId && t != null && t > weekAgoMs && t <= now) {
      ratingsWeek += 1;
      activeWeek.add(r.userId);
    }
  }
  const perActiveWeek = activeWeek.size ? ratingsWeek / activeWeek.size : null;
  out.push(
    metric({
      id: 'ratingsPerActiveUserWeek',
      label: 'Ratings per active user per week',
      value: round2(perActiveWeek),
      unit: '',
      goal: '',
      status: perActiveWeek == null ? 'unknown' : 'info',
      n: activeWeek.size,
      nLabel: 'active users, last 7 days',
      note: activeWeek.size ? 'Ratings in the last 7 days divided by users who opened the app or rated in that time.' : 'No active users in the last 7 days.',
    }),
  );

  // ---- Active and new users per week ----------------------------------------
  // Counts of real people over the last 6 weeks (each window is 7 days, the
  // newest ends now). Active = opened the app or rated in the window.
  const weekly = [];
  for (let k = 5; k >= 0; k -= 1) {
    const endMs = now - k * STATS_WEEK_MS;
    const startMs = endMs - STATS_WEEK_MS;
    const from = dateUtc(startMs);
    const to = dateUtc(endMs);
    const active = new Set();
    for (const [uid, days] of opens) for (const d of days) if (d > from && d <= to) active.add(uid);
    for (const r of reviews) {
      const t = ratingTime(r);
      if (r?.userId && t != null && t > startMs && t <= endMs) active.add(r.userId);
    }
    const newUsers = users.filter((u) => u?.createdAt != null && u.createdAt > startMs && u.createdAt <= endMs).length;
    weekly.push({ weekEnding: to, active: active.size, newUsers });
  }
  const thisWeek = weekly[weekly.length - 1];
  out.push(
    metric({
      id: 'weeklyUsers',
      label: 'Active and new users per week',
      value: users.length || thisWeek.active ? thisWeek.active : null,
      unit: '',
      goal: '',
      status: users.length || thisWeek.active ? 'info' : 'unknown',
      n: users.length,
      nLabel: 'accounts in total',
      newUsers: thisWeek.newUsers,
      weekly,
      note: 'Counts of people, not percentages. Active = opened the app or rated in the 7 days.',
    }),
  );

  // ---- Time to first real check-in -----------------------------------------
  const created = new Map(users.filter((u) => u?.createdAt != null).map((u) => [u.uid, u.createdAt]));
  const firstCheckin = new Map();
  for (const c of checkins) {
    if (!c?.userId || c.ratingOnly === true || c.createdAt == null) continue;
    const made = created.get(c.userId);
    if (made == null || c.createdAt < made) continue;
    if (!firstCheckin.has(c.userId) || c.createdAt < firstCheckin.get(c.userId)) firstCheckin.set(c.userId, c.createdAt);
  }
  const hours = [...firstCheckin].map(([uid, at]) => (at - created.get(uid)) / 3600000);
  const medHours = median(hours);
  out.push(
    metric({
      id: 'timeToFirstCheckin',
      label: 'Time to first check-in',
      value: round1(medHours),
      unit: ' h',
      goal: `under ${GOAL_FIRST_CHECKIN_HOURS} hours (median)`,
      status: judge(medHours, medHours < GOAL_FIRST_CHECKIN_HOURS),
      n: hours.length,
      nLabel: `of ${created.size} users have checked in`,
      note: hours.length ? '' : 'No user has a real check-in after their createdAt yet.',
    }),
  );

  // ---- Referrals ------------------------------------------------------------
  const refs = ds.referrals || [];
  const referrers = new Set(refs.map((r) => r.referrerUid).filter(Boolean));
  const coef = referrers.size ? refs.length / referrers.size : null;
  out.push(
    metric({
      id: 'referralCoefficient',
      label: 'Referral coefficient',
      value: round2(coef),
      unit: '',
      goal: `above ${GOAL_REFERRAL_COEFFICIENT.toFixed(1)}`,
      status: judge(coef, coef > GOAL_REFERRAL_COEFFICIENT),
      n: referrers.size,
      nLabel: 'users who invited',
      note: referrers.size ? 'Invited users per user who invites.' : 'No referrals recorded yet.',
    }),
  );
  const referred = new Set(refs.map((r) => r.referredUid).filter(Boolean));
  const recent = users.filter((u) => u?.createdAt != null && now - u.createdAt <= VIRAL_WINDOW_DAYS * STATS_DAY_MS);
  const viral = recent.length >= STATS_MIN_SAMPLE ? (recent.filter((u) => referred.has(u.uid)).length / recent.length) * 100 : null;
  out.push(
    metric({
      id: 'viralSignupRate',
      label: 'Viral signup rate',
      value: round1(viral),
      unit: '%',
      goal: `above ${GOAL_VIRAL_SIGNUP_PCT}%`,
      status: judge(viral, viral > GOAL_VIRAL_SIGNUP_PCT),
      n: recent.length,
      nLabel: `new users, last ${VIRAL_WINDOW_DAYS} days`,
      note: recent.length ? 'Share of new users who came from a referral.' : `No new users in the last ${VIRAL_WINDOW_DAYS} days.`,
    }),
  );

  // ---- New users per week / 10 ratings by day 2 ------------------------------
  const lastWeekUsers = users.filter((u) => u?.createdAt != null && now - u.createdAt <= STATS_WEEK_MS).length;
  out.push(
    metric({
      id: 'newUsersPerWeek',
      label: 'New users, last 7 days',
      value: users.some((u) => u?.createdAt != null) ? lastWeekUsers : null,
      unit: '',
      goal: 'no goal set',
      status: users.some((u) => u?.createdAt != null) ? 'info' : 'unknown',
      n: users.length,
      nLabel: 'users in total',
      note: 'Needs createdAt on users (run the backfill).',
    }),
  );
  const ratingsBy = new Map();
  for (const r of reviews) {
    const t = ratingTime(r);
    if (!r?.userId || t == null) continue;
    if (!ratingsBy.has(r.userId)) ratingsBy.set(r.userId, []);
    ratingsBy.get(r.userId).push(t);
  }
  const windowMs = RATINGS_BY_DAY2.days * STATS_DAY_MS;
  const matured = users.filter((u) => u?.createdAt != null && u.createdAt + windowMs <= now);
  const quick = matured.filter(
    (u) => (ratingsBy.get(u.uid) || []).filter((t) => t <= u.createdAt + windowMs).length >= RATINGS_BY_DAY2.ratings,
  ).length;
  out.push(
    metric({
      id: 'tenRatingsByDay2',
      label: `New users with ${RATINGS_BY_DAY2.ratings} ratings by day ${RATINGS_BY_DAY2.days}`,
      value: matured.length ? round1((quick / matured.length) * 100) : null,
      unit: '%',
      goal: 'no goal set',
      status: matured.length ? 'info' : 'unknown',
      n: matured.length,
      nLabel: 'users old enough',
      note: matured.length ? '' : 'No user is old enough yet.',
    }),
  );

  // ---- Taste score average (+ baseline) --------------------------------------
  const latest = new Map();
  for (const h of ds.tasteHistory || []) {
    if (!h?.userId) continue;
    const p = latest.get(h.userId);
    if (!p || h.at > p.at) latest.set(h.userId, h);
  }
  const scored = [...latest.values()].filter((h) => Number.isFinite(h.score));
  const avg = mean(scored.map((h) => h.score));
  const bases = scored.map((h) => h.baselineScore).filter((x) => Number.isFinite(x));
  out.push(
    metric({
      id: 'tasteScoreAvg',
      label: 'Taste score, average',
      value: round1(avg),
      unit: '%',
      goal: `${GOAL_TASTE_SCORE_AVG}%`,
      status: judge(avg, avg >= GOAL_TASTE_SCORE_AVG),
      n: scored.length,
      nLabel: 'users with a score',
      baseline: bases.length ? { value: round1(mean(bases)), unit: '%', label: 'Always guessing each user’s usual answer' } : null,
      note: scored.length ? '' : 'No user has a taste score yet.',
    }),
  );

  return out;
}

export { growthStats as growthSeries };
