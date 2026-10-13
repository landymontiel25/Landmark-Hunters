import { openDaySets, openedOnDay, retentionDayOver, retentionUsers } from './adminStats.js';
import { familySet } from './familyAccounts.js';
import { annotateShown } from './maprRank/metrics.js';
import { activeUsers, COMMUNITY_REGIONS } from './community.js';
import { canonicalRegionId } from '../data/regions.js';

// The documents the separate admin dashboard (admin-dashboard/) reads, as
// pure functions over the stats dataset (api/_lib/statsData.js shapes, times
// in ms). api/_lib/dashboardDocs.js writes them every night. Totals only:
// never a uid, name, email or location, except big_misses, which is per
// landmark (a place, not a person).

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_STARS = { 'highly-recommend': 5, 'worth-trying': 3, 'probably-skip': 1 };
const TIER_LEVEL = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };
const TAP_LEVEL = { yes: 'positive', unsure: 'neutral', no: 'negative' };
const LEVEL_STARS = { positive: 5, neutral: 3, negative: 1 };
export const dateUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (date) => Date.parse(`${date}T00:00:00.000Z`);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const ratio = (a, b) => (b > 0 ? a / b : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratingAt = (r) => r.ratedAt ?? r.updatedAt ?? r.createdAt ?? null;
const realCheckins = (ds) => (ds.checkins || []).filter((c) => c.ratingOnly !== true && Number.isFinite(c.createdAt));

// The last `n` UTC dates ending with `last`, oldest first.
export function lastDates(last, n) {
  return Array.from({ length: n }, (_, i) => dateUtc(dayStart(last) - (n - 1 - i) * DAY_MS));
}

// growth_metrics/{date}. active_users counts everyone who opened the app
// that day; active_users_outside_family leaves out founder and family
// accounts (familyAccounts.js).
export function growthDocs(ds, dates) {
  const family = familySet(ds);
  const visits = realCheckins(ds).sort((a, b) => a.createdAt - b.createdAt);
  const seenPair = new Set();
  const byDate = new Map(dates.map((d) => [d, { visits: 0, repeat: 0 }]));
  let cumulative = 0;
  const cumulativeAt = new Map();
  for (const c of visits) {
    const d = dateUtc(c.createdAt);
    const pair = `${c.userId}|${c.landmarkId}`;
    const repeat = seenPair.has(pair);
    seenPair.add(pair);
    cumulative += 1;
    cumulativeAt.set(d, cumulative);
    const slot = byDate.get(d);
    if (slot) {
      slot.visits += 1;
      if (repeat) slot.repeat += 1;
    }
  }
  let running = 0;
  const sortedDays = [...cumulativeAt.keys()].sort();
  return dates.map((date) => {
    for (const d of sortedDays) if (d <= date) running = Math.max(running, cumulativeAt.get(d));
    const activeIds = new Set((ds.openDays || []).filter((o) => o.date === date).map((o) => o.uid));
    const active = activeIds.size;
    const activeOutside = [...activeIds].filter((uid) => !family.has(uid)).length;
    const fresh = (ds.users || []).filter((u) => Number.isFinite(u.createdAt) && dateUtc(u.createdAt) === date).length;
    const slot = byDate.get(date);
    return { date, active_users: active, active_users_outside_family: activeOutside, new_users: fresh, landmarks_visited: slot.visits, total_landmarks_visited_cumulative: running, repeat_landmark_visits: slot.repeat };
  });
}

// engagement_metrics/{date}
// Verified presence per day (docs/discovery-network-plan.md, Phase 0): real
// check-ins, how many the server checked, passed and failed, the pass rate of
// the checked ones (Phase 0 is done at 80%+), and failures by reason.
export function presenceDocs(ds, dates) {
  const byDate = new Map(dates.map((d) => [d, { checkins: 0, checked: 0, verified: 0, reasons: {} }]));
  for (const c of realCheckins(ds)) {
    const slot = byDate.get(dateUtc(c.createdAt));
    if (!slot) continue;
    slot.checkins += 1;
    if (!c.presence) continue;
    slot.checked += 1;
    if (c.presence.verified) slot.verified += 1;
    else {
      const why = c.presence.reason || 'unknown';
      slot.reasons[why] = (slot.reasons[why] || 0) + 1;
    }
  }
  return dates.map((date) => {
    const s = byDate.get(date);
    return { date, checkins: s.checkins, checked: s.checked, verified: s.verified, failed: s.checked - s.verified, verified_rate: r4(ratio(s.verified, s.checked)), fail_reasons: s.reasons };
  });
}

// Tips (Phase 1), one doc per day: the state of every tip at the end of
// that day's run (live, held, hidden, withdrawn, removed), tips posted and
// impressions logged that day, people with a live tip posted in the last 30
// days, live tips on distinct places, Helpful/Save totals, and live tips per
// region. Counts only; tip text never reaches the dashboard docs.
export function tipDocs(ds, dates) {
  const tips = ds.tips || [];
  const live = tips.filter((t) => t.status === 'live' && !t.hidden);
  const state = {
    live: live.length,
    held: tips.filter((t) => t.status === 'held').length,
    hidden: tips.filter((t) => t.status === 'live' && t.hidden).length,
    withdrawn: tips.filter((t) => t.status === 'withdrawn').length,
    removed: tips.filter((t) => t.status === 'removed').length,
    reported_live: live.filter((t) => t.reportCount > 0).length,
    live_places: new Set(live.map((t) => `${t.region}/${t.landmarkId}`)).size,
    helpful_total: tips.reduce((n, t) => n + (t.helpful || 0), 0),
    saved_total: tips.reduce((n, t) => n + (t.saved || 0), 0),
    live_by_region: {},
  };
  for (const t of live) state.live_by_region[t.region || 'unknown'] = (state.live_by_region[t.region || 'unknown'] || 0) + 1;
  return dates.map((date) => {
    const from = dayStart(date);
    const to = from + DAY_MS;
    const authors30 = new Set(live.filter((t) => t.createdAt >= to - 30 * DAY_MS && t.createdAt < to).map((t) => t.authorUid));
    return {
      date,
      ...state,
      posted: tips.filter((t) => t.createdAt >= from && t.createdAt < to).length,
      impressions: (ds.tipImpressions || []).filter((r) => r.shownAt >= from && r.shownAt < to).reduce((n, r) => n + (r.tipIds?.length || 0), 0),
      authors_30d: authors30.size,
    };
  });
}

// The discovery network (Phases 2 to 6), one doc per day: follows so far.
// launch_* is the launch area (COMMUNITY_REGIONS): people active there in
// the last 30 days, and how many of them follow at least one discoverer
// (someone with a live tip). Phase 2 is done when that share reaches 60%.
function pickSplit(rows) {
  const part = (xs) => ({ shown: xs.length, skip: r4(ratio(xs.filter((r) => r.action === 'skipped').length, xs.length)), visit: r4(ratio(xs.filter((r) => r.visited).length, xs.length)) });
  const community = part(rows.filter((r) => Number(r.communityWeight) > 1));
  const mapr = part(rows.filter((r) => !(Number(r.communityWeight) > 1)));
  return {
    community_picks_shown_30d: community.shown,
    community_skip_rate_30d: community.skip,
    community_visit_rate_30d: community.visit,
    mapr_picks_shown_30d: mapr.shown,
    mapr_skip_rate_30d: mapr.skip,
    mapr_visit_rate_30d: mapr.visit,
  };
}

export function networkDocs(ds, dates, annotated = annotateShown(ds)) {
  // Follows from or to a deleted account don't count (the nightly upkeep
  // removes them after this runs).
  const people = new Set((ds.users || []).map((u) => u.uid));
  const follows = (ds.follows || []).filter((f) => !ds.users || (people.has(f.followerUid) && people.has(f.followeeUid)));
  const discoverers = new Set((ds.tips || []).filter((t) => t.status === 'live' && !t.hidden).map((t) => t.authorUid));
  return dates.map((date) => {
    const from = dayStart(date);
    const to = from + DAY_MS;
    const upTo = follows.filter((f) => !Number.isFinite(f.createdAt) || f.createdAt < to);
    const active = activeUsers(ds, { nowMs: to - 1, regions: COMMUNITY_REGIONS, canonical: canonicalRegionId });
    const followsDiscoverer = new Set(upTo.filter((f) => discoverers.has(f.followeeUid)).map((f) => f.followerUid));
    const launchFollowing = [...active].filter((u) => followsDiscoverer.has(u)).length;
    return {
      date,
      follows_total: upTo.length,
      new_follows: follows.filter((f) => f.createdAt >= from && f.createdAt < to).length,
      people_following: new Set(upTo.map((f) => f.followerUid)).size,
      people_followed: new Set(upTo.map((f) => f.followeeUid)).size,
      discoverers: discoverers.size,
      launch_active: active.size,
      launch_following_discoverer: launchFollowing,
      launch_follow_rate: r4(ratio(launchFollowing, active.size)),
      // Phase 3 is done when community picks match at least as well as
      // Mapr-only picks over 30 days: picks shown in the 30 days to this
      // date, split by whether someone's find lifted them.
      ...pickSplit(annotated.filter((r) => r.shownAt >= to - 30 * DAY_MS && r.shownAt < to)),
    };
  });
}

export function engagementDocs(ds, dates, annotated = annotateShown(ds)) {
  const visits = realCheckins(ds);
  return dates.map((date) => {
    const from = dayStart(date);
    const to = from + DAY_MS;
    const yes = (ds.pickFeedback || []).filter((t) => t.verdict === 'yes' && t.at >= from && t.at < to);
    const visitedAfter = yes.filter((t) => visits.some((c) => c.userId === t.userId && c.landmarkId === t.landmarkId && c.createdAt >= t.at && c.createdAt <= t.at + 7 * DAY_MS));
    const shown = annotated.filter((r) => r.shownAt >= from && r.shownAt < to);
    const ratings = (ds.reviews || []).filter((r) => ratingAt(r) >= from && ratingAt(r) < to && TIER_STARS[r.ratingTier]);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) dist[TIER_STARS[r.ratingTier]] += 1;
    return {
      date,
      avg_dwell_time_s: null,
      tap_to_visit_rate: r4(ratio(visitedAfter.length, yes.length)),
      skip_rate: r4(ratio(shown.filter((r) => r.action === 'skipped').length, shown.length)),
      rating_distribution: Object.fromEntries(Object.entries(dist).map(([k, v]) => [String(k), v])),
      avg_rating: r4(mean(ratings.map((r) => TIER_STARS[r.ratingTier]))),
      ratings: ratings.length,
      shown: shown.length,
    };
  });
}

// retention_cohorts/{signup date}: the same rule as the Academy tab's
// retention (adminStats.js retention()). The cohort is the users who signed
// up that day, on or after the day open tracking began, founder and family
// accounts left out; day_N counts those who opened the app ON day N (null
// until day N is over). churn = share of the cohort (14+ days old) with no
// open in the last 14 days.
export function retentionDocs(ds, cohortDates, now = Date.now()) {
  const opens = openDaySets(ds);
  const users = retentionUsers(ds);
  const recentFrom = dateUtc(now - 14 * DAY_MS);
  return cohortDates.map((date) => {
    const cohort = users.filter((u) => dateUtc(u.createdAt) === date);
    const on = (n) => (retentionDayOver(dayStart(date), n, now) ? cohort.filter((u) => openedOnDay(opens, u, n)).length : null);
    const d7 = on(7);
    const d30 = on(30);
    const d90 = on(90);
    const oldEnough = dayStart(date) <= now - 14 * DAY_MS;
    const churned = oldEnough ? cohort.filter((u) => ![...(opens.get(u.uid) || [])].some((d) => d >= recentFrom)).length : null;
    return {
      cohort_date: date,
      day_0: cohort.length,
      day_7: d7,
      day_30: d30,
      day_90: d90,
      retention_7_day: d7 == null ? null : r4(ratio(d7, cohort.length)),
      retention_30_day: d30 == null ? null : r4(ratio(d30, cohort.length)),
      churn_rate: churned == null ? null : r4(ratio(churned, cohort.length)),
    };
  });
}

// The level a shown pick got: its rating if any in the window, else its tap.
function reactionLevels(ds, annotated, windowDays = 7) {
  const taps = new Map();
  for (const t of ds.pickFeedback || []) {
    const k = `${t.userId}|${t.landmarkId}`;
    if (!taps.has(k)) taps.set(k, []);
    taps.get(k).push(t);
  }
  return annotated.map((r) => {
    let level = null;
    const review = (ds.reviews || []).find((x) => x.userId === r.userId && x.landmarkId === r.landmarkId && ratingAt(x) >= r.shownAt && ratingAt(x) <= r.shownAt + windowDays * DAY_MS);
    if (review) level = TIER_LEVEL[review.ratingTier] || null;
    else {
      const tap = (taps.get(`${r.userId}|${r.landmarkId}`) || []).filter((t) => t.at >= r.shownAt && t.at <= r.shownAt + windowDays * DAY_MS).sort((a, b) => b.at - a.at)[0];
      if (tap) level = TAP_LEVEL[tap.verdict] || null;
    }
    return { ...r, level };
  });
}

// accuracy_by_category / accuracy_by_city for the picks shown in the
// `days` days ending `date`: { [key]: { match_rate, skip_rate, repeat_rate, sample_size } }
export function accuracyDocs(ds, date, { days = 30, annotated = annotateShown(ds) } = {}) {
  const to = dayStart(date) + DAY_MS;
  const from = to - days * DAY_MS;
  const rows = reactionLevels(ds, annotated.filter((r) => r.shownAt >= from && r.shownAt < to));
  const group = (keyFn) => {
    const out = {};
    for (const r of rows) {
      for (const k of keyFn(r)) {
        if (!k) continue;
        const g = (out[k] ||= { shown: 0, reacted: 0, positive: 0, skipped: 0, repeat: 0 });
        g.shown += 1;
        if (r.level) g.reacted += 1;
        if (r.level === 'positive') g.positive += 1;
        if (r.action === 'skipped') g.skipped += 1;
        if (r.repeat) g.repeat += 1;
      }
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, g]) => [k, { match_rate: r4(ratio(g.positive, g.reacted)), skip_rate: r4(ratio(g.skipped, g.shown)), repeat_rate: r4(ratio(g.repeat, g.shown)), sample_size: g.shown }])
    );
  };
  return {
    byCategory: { date, window_days: days, categories: group((r) => (Array.isArray(r.categories) && r.categories.length ? [r.categories[0]] : ['unknown'])) },
    byCity: { date, window_days: days, cities: group((r) => [r.region || 'unknown']) },
  };
}

// taste_score/{date}: each user's latest taste score as of the end of the day.
export function tasteDocs(ds, dates) {
  const byUser = new Map();
  for (const h of ds.tasteHistory || []) {
    if (!Number.isFinite(h.at) || !Number.isFinite(h.score)) continue;
    if (!byUser.has(h.userId)) byUser.set(h.userId, []);
    byUser.get(h.userId).push(h);
  }
  for (const list of byUser.values()) list.sort((a, b) => a.at - b.at);
  return dates.map((date) => {
    const end = dayStart(date) + DAY_MS;
    const latest = [];
    for (const list of byUser.values()) {
      let last = null;
      for (const h of list) if (h.at < end) last = h;
      if (last) latest.push(last.score / 100);
    }
    return { date, avg_taste_score: r4(mean(latest)), users_with_taste_score: latest.length };
  });
}

// big_misses/{region__landmarkId}: places Mapr expected people to like that
// they skipped or rated low. A place is listed once its shown picks were
// predicted positive and either got a "Didn't like it" rating or were
// skipped at least BIG_MISS_MIN_SKIPS times. Stats only: the reviewed /
// resolution fields belong to the dashboard and are never written here.
export const BIG_MISS_MIN_SKIPS = 3;
export function bigMissDocs(ds, landmarkName = () => null, annotated = annotateShown(ds)) {
  const by = new Map();
  for (const r of annotated) {
    if (r.predicted !== 'positive') continue;
    const k = `${r.region || 'unknown'}__${r.landmarkId}`;
    const g = by.get(k) || { region: r.region || null, landmarkId: r.landmarkId, expected: [], actual: [], skips: 0, hates: 0, last: 0 };
    g.expected.push(LEVEL_STARS[r.predicted]);
    if (r.rating != null) g.actual.push(r.rating);
    if (r.action === 'skipped') g.skips += 1;
    if (r.rating === 1) g.hates += 1;
    g.last = Math.max(g.last, r.shownAt);
    by.set(k, g);
  }
  const out = [];
  for (const [id, g] of by) {
    if (!(g.hates > 0 || g.skips >= BIG_MISS_MIN_SKIPS)) continue;
    out.push({
      id,
      landmark_id: g.landmarkId,
      region: g.region,
      landmark_name: landmarkName(g.region, g.landmarkId) || g.landmarkId,
      expected_rating: r4(mean(g.expected)),
      actual_rating: r4(mean(g.actual)),
      skip_count: g.skips,
      hate_count: g.hates,
      last_shown_at: g.last,
    });
  }
  return out.sort((a, b) => b.skip_count - a.skip_count || b.hate_count - a.hate_count);
}

// The flat Mapr fields the dashboard's overview and Mapr page read, from one
// daily report (src/lib/maprRank/metrics.js computeDailyReport).
export function maprFlatFields(report) {
  const ncf = report.experiments?.ncf;
  const v2 = report.experiments?.maprV2;
  return {
    match_rate: report.matchRate ?? null,
    skip_rate: report.skipRate ?? null,
    repeat_rate: report.repeatRate ?? null,
    novelty_percentage: report.novelty?.weeklyNewShare == null ? null : r4(report.novelty.weeklyNewShare * 100),
    stagnation_users: report.stagnation?.stagnating ?? 0,
    ncf_model_health: report.models?.ncfTestAccuracy ?? null,
    a_b_control_rate: ncf?.arms?.control?.ctr ?? null,
    a_b_treatment_rate: ncf?.arms?.treatment?.ctr ?? null,
    a_b_control_n: ncf?.arms?.control?.shown ?? 0,
    a_b_treatment_n: ncf?.arms?.treatment?.shown ?? 0,
    a_b_p_value: ncf?.ctr?.pValue ?? null,
    a_b_days: ncf?.days ?? 0,
    mapr_v2_control_ctr: v2?.arms?.control?.ctr ?? null,
    mapr_v2_treatment_ctr: v2?.arms?.treatment?.ctr ?? null,
    mapr_v2_new_user_ctr_gain: v2?.newUsers?.gain?.ctr ?? null,
    mapr_v2_served_share: v2?.servedV2Share ?? null,
    mapr_v2_decision: v2?.decision ?? null,
  };
}

// Phase 2 Slack alerts: match rate down more than 20% (relative) from the
// day before, and the weekly NCF training not completing.
export function slackAlerts(report, previous, ncfStatus) {
  const out = [];
  if (previous?.matchRate != null && report.matchRate != null && previous.matchRate > 0 && report.matchRate < previous.matchRate * 0.8) {
    out.push(`Match rate fell ${Math.round((1 - report.matchRate / previous.matchRate) * 100)}% in a day (${Math.round(previous.matchRate * 100)}% → ${Math.round(report.matchRate * 100)}%).`);
  }
  if (ncfStatus && ncfStatus.ok === false && ncfStatus.reason !== 'not-enough-data') out.push(`The NCF model failed to train: ${ncfStatus.reason || 'unknown error'}.`);
  return out;
}
