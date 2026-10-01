import { MATCH_ELIGIBLE_MIN_RATINGS, MATCH_WEEK_MS, MATCH_WEIGHT_RATING, MATCH_WEIGHT_TAP } from './maprConstants.js';

// Which shown picks count toward Mapr's match rate. A place counts once per
// user per MATCH_WEEK_MS: the first showing opens the window, and later
// showings of the same place to the same user inside it are dropped (the
// next one after the window counts and opens a new window).
//
// Only real shown rows count: not test rows, and not old build-time rows
// (no shownAt/setId), which never proved the pick reached the screen.
// `rows` are recommendation_log docs; shownAt is ms or a Firestore timestamp.
const msOf = (v) => (typeof v === 'number' ? v : v?.seconds != null ? v.seconds * 1000 : v?.toMillis?.() ?? null);

export function countedShownPicks(rows, weekMs = MATCH_WEEK_MS) {
  const shown = (rows || [])
    .filter((r) => r && r.isTest !== true && r.setId && r.userId && r.landmarkId)
    .map((r) => ({ r, ms: msOf(r.shownAt) }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);
  const lastCounted = new Map();
  const out = [];
  for (const { r, ms } of shown) {
    const k = `${r.userId}|${r.region || ''}/${r.landmarkId}`;
    const prev = lastCounted.get(k);
    if (prev != null && ms - prev < weekMs) continue;
    lastCounted.set(k, ms);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Match rate: of everyone's reactions to Mapr picks, how many were positive.
//
//   positive = "I'd go" tap / "I loved it" rating
//   neutral  = "Not sure" tap / "It was ok" rating
//   negative = "Not for me" tap / "Didn't like it" rating
//
// match rate = weighted positive / weighted total, where a check-in rating
// weighs MATCH_WEIGHT_RATING and a pre-visit tap MATCH_WEIGHT_TAP. A pick
// with both a tap and a rating counts both. Taps count the same for 'Just me'
// and 'A group'. Only reactions marked as coming from a pick count, and only
// if they match a real shown row (same user, place and setId, not a test row)
// and did not happen before that row's shownAt.
//
// computeMatchRate is pure over plain arrays (no Firestore). It returns totals
// only: opaque user ids as keys, counts and rates, never names, emails or
// locations.
const TAP_LEVEL = { yes: 'positive', unsure: 'neutral', no: 'negative' };
const TIER_LEVEL = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };
const LEVELS = ['positive', 'neutral', 'negative'];

const zero = () => ({ positive: 0, neutral: 0, negative: 0 });
const rate = (pos, total) => (total > 0 ? pos / total : null);

function summarize(taps, ratings, shown) {
  const tapCount = taps.positive + taps.neutral + taps.negative;
  const ratingCount = ratings.positive + ratings.neutral + ratings.negative;
  const weightedPositive = taps.positive * MATCH_WEIGHT_TAP + ratings.positive * MATCH_WEIGHT_RATING;
  const weightedTotal = tapCount * MATCH_WEIGHT_TAP + ratingCount * MATCH_WEIGHT_RATING;
  return {
    shown,
    taps: { ...taps },
    ratings: { ...ratings },
    tapCount,
    ratingCount,
    weightedPositive,
    weightedTotal,
    matchRate: rate(weightedPositive, weightedTotal),
  };
}

// taps / ratings: [{ userId, landmarkId, level, pickSetId, at }] (ms)
// shown: recommendation_log rows; per-user `shown` counts use countedShownPicks.
export function computeMatchRate({ shown = [], taps = [], ratings = [] } = {}, { minRatings = MATCH_ELIGIBLE_MIN_RATINGS, weekMs } = {}) {
  const rows = (shown || []).filter((r) => r && r.isTest !== true && r.setId && r.userId && r.landmarkId);
  const shownAtBy = new Map();
  for (const r of rows) {
    const ms = msOf(r.shownAt);
    if (!Number.isFinite(ms)) continue;
    const k = `${r.userId}|${r.landmarkId}|${r.setId}`;
    if (!shownAtBy.has(k) || ms < shownAtBy.get(k)) shownAtBy.set(k, ms);
  }
  const countedBy = new Map();
  for (const r of countedShownPicks(rows, weekMs)) countedBy.set(r.userId, (countedBy.get(r.userId) || 0) + 1);

  const users = new Map();
  const slot = (u) => {
    if (!users.has(u)) users.set(u, { taps: zero(), ratings: zero() });
    return users.get(u);
  };
  for (const u of countedBy.keys()) slot(u);

  const take = (list, bucketKey) => {
    for (const x of list || []) {
      if (!x || !x.userId || !x.landmarkId || !x.pickSetId || !LEVELS.includes(x.level)) continue;
      const shownAt = shownAtBy.get(`${x.userId}|${x.landmarkId}|${x.pickSetId}`);
      if (shownAt == null) continue; // not a pick we can prove was shown
      if (!Number.isFinite(x.at) || x.at < shownAt) continue; // reacted before it was shown
      slot(x.userId)[bucketKey][x.level] += 1;
    }
  };
  take(taps, 'taps');
  take(ratings, 'ratings');

  const perUser = {};
  const allTaps = zero();
  const allRatings = zero();
  let eligibleUsers = 0;
  let eligPos = 0;
  let eligTotal = 0;
  for (const [uid, { taps: t, ratings: r }] of users) {
    const s = summarize(t, r, countedBy.get(uid) || 0);
    s.eligible = s.ratingCount >= minRatings;
    perUser[uid] = s;
    for (const l of LEVELS) {
      allTaps[l] += t[l];
      allRatings[l] += r[l];
    }
    if (s.eligible) {
      eligibleUsers += 1;
      eligPos += s.weightedPositive;
      eligTotal += s.weightedTotal;
    }
  }
  const overall = summarize(allTaps, allRatings, Object.values(perUser).reduce((n, u) => n + u.shown, 0));
  overall.users = users.size;
  overall.eligibleUsers = eligibleUsers;
  // Pooled over only the users the target applies to (10+ ratings).
  overall.eligibleMatchRate = rate(eligPos, eligTotal);
  return { perUser, overall };
}

// Turns raw Firestore rows (plain objects, e.g. doc.data()) into computeMatchRate
// inputs for a set of users (null = everyone). A review's reaction time is its
// updatedAt; a tap's is its `at`.
export function gatherMatchRateInputs({ recommendationLog = [], pickFeedback = [], reviews = [] } = {}, userIds = null) {
  const want = userIds ? new Set(userIds) : null;
  const mine = (r) => r && r.userId && (!want || want.has(r.userId));
  return {
    shown: (recommendationLog || []).filter(mine),
    taps: (pickFeedback || []).filter(mine).map((r) => ({
      userId: r.userId,
      landmarkId: r.landmarkId,
      level: TAP_LEVEL[r.verdict],
      pickSetId: r.pickSetId,
      at: msOf(r.at),
    })),
    ratings: (reviews || []).filter(mine).map((r) => ({
      userId: r.userId,
      landmarkId: r.landmarkId,
      level: TIER_LEVEL[r.ratingTier],
      pickSetId: r.pickSetId,
      at: msOf(r.updatedAt),
    })),
  };
}
