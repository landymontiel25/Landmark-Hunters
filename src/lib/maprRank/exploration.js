import { EXPLORATION as CFG } from './config.js';

// Week 4: epsilon-greedy exploration. Each slot of a built set is filled from
// the exploitation queue (the best predicted matches) with probability
// 1 - epsilon, and from the exploration set (novel, unexpected but still good
// places) with probability epsilon. Epsilon depends on the user's state.
// Pure functions; the device-side history they read lives in seenHistory.js.

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_STARS = { 'highly-recommend': 5, 'worth-trying': 3, 'probably-skip': 1 };
const msOf = (v) => (typeof v === 'number' ? v : v?.seconds != null ? v.seconds * 1000 : v?.toMillis?.() ?? null);
const reviewMs = (r) => msOf(r?.ratedAt) ?? msOf(r?.updatedAt) ?? msOf(r?.createdAt) ?? r?.updatedAtMs ?? null;

// ---- User state -------------------------------------------------------------

// myReviews: RatingsContext's { [landmarkId]: review }
// createdAtMs: when the account was made
// shown: { [landmarkId]: { count, lastShownAt, firstShownAt } } (seenHistory)
// votes: local pick_feedback map { [landmarkId]: { verdict, at } }
export function userState({ myReviews = {}, createdAtMs = null, shown = {}, votes = {}, now = Date.now(), cfg = CFG }) {
  const reviews = Object.values(myReviews || {}).filter((r) => r?.landmarkId && TIER_STARS[r.ratingTier]);
  const stars = reviews.map((r) => TIER_STARS[r.ratingTier]);
  const weekAgo = now - 7 * DAY_MS;
  const recent = reviews.filter((r) => (reviewMs(r) ?? 0) >= weekAgo);
  const visited7d = new Set(recent.filter((r) => r.visited !== false).map((r) => r.landmarkId));
  // Skip rate: picks shown in the window that got no tap and no rating since.
  const since = now - cfg.skipWindowDays * DAY_MS;
  let shownCount = 0;
  let skipped = 0;
  for (const [id, s] of Object.entries(shown || {})) {
    const at = s?.lastShownAt;
    if (!Number.isFinite(at) || at < since) continue;
    shownCount++;
    const first = Number.isFinite(s.firstShownAt) ? s.firstShownAt : at;
    const rated = myReviews?.[id] && (reviewMs(myReviews[id]) ?? 0) >= first;
    const tapped = votes?.[id] && (votes[id].at || 0) >= first;
    if (!rated && !tapped) skipped++;
  }
  return {
    daysActive: Number.isFinite(createdAtMs) ? Math.max(0, (now - createdAtMs) / DAY_MS) : null,
    numRatings: reviews.length,
    avgRating: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
    skipRate: shownCount ? skipped / shownCount : null,
    ratings7d: recent.length,
    visits7d: visited7d.size,
  };
}

// Stagnating: fewer than 3 ratings AND fewer than 5 distinct places visited in
// the last 7 days.
export const isStagnating = (s, cfg = CFG) => !!s && s.ratings7d < cfg.stagnantRatings7d && s.visits7d < cfg.stagnantVisits7d;

// The spec's rule, in order (first match wins), then the stagnation bump.
export function epsilonFor(s, cfg = CFG) {
  let eps = cfg.baseEpsilon;
  let reason = 'base';
  if (s?.daysActive != null && s.daysActive < cfg.newUserDays) {
    eps = cfg.newUserEpsilon;
    reason = 'new-user';
  } else if (s?.avgRating != null && s.avgRating < cfg.lowRating) {
    eps = cfg.lowRatingEpsilon;
    reason = 'low-rating';
  } else if (s?.skipRate != null && s.skipRate > cfg.highSkipRate) {
    eps = cfg.highSkipEpsilon;
    reason = 'high-skip';
  } else if (s?.avgRating != null && s.avgRating > cfg.highRating && s.numRatings >= cfg.highRatingMinRatings) {
    eps = cfg.highRatingEpsilon;
    reason = 'high-confidence';
  }
  if (s && s.ratings7d < cfg.stagnantRatings7d) {
    eps = Math.min(eps + cfg.stagnationBoost, cfg.maxEpsilon);
    reason += '+quiet-week';
  }
  return { epsilon: Math.round(eps * 1000) / 1000, reason };
}

// ---- Novelty score ------------------------------------------------------------

export function novelty(timesSeen, cfg = CFG) {
  const n = Number.isFinite(timesSeen) && timesSeen > 0 ? Math.floor(timesSeen) : 0;
  return cfg.noveltyBySeen[Math.min(n, cfg.noveltyBySeen.length - 1)];
}

// Cosine between the user's tag profile { tag: score } and the place's tags
// (binary). Tags the profile does not hold count as 0.
export function tagCosine(profile, tags) {
  const t = [...new Set(tags || [])];
  if (!t.length) return 0;
  let dot = 0;
  for (const tag of t) dot += Number(profile?.[tag]) || 0;
  let norm = 0;
  for (const v of Object.values(profile || {})) norm += (Number(v) || 0) ** 2;
  if (!norm) return 0;
  return dot / (Math.sqrt(norm) * Math.sqrt(t.length));
}

export function unexpectedness(profile, tags, cfg = CFG) {
  const contradiction = 1 - tagCosine(profile, tags);
  const [high, mid, low] = cfg.unexpectedValues;
  return contradiction > cfg.unexpectedHigh ? high : contradiction > cfg.unexpectedMid ? mid : low;
}

// rating: { avg, count } (public ratings), or nothing.
export function quality(rating, cfg = CFG) {
  const count = Number(rating?.count) || 0;
  const avg = count && Number.isFinite(Number(rating?.avg)) ? Number(rating.avg) : cfg.qualityPriorRating;
  const star = Math.max(0, Math.min(1, avg / 5));
  const reviews = Math.min(count / cfg.qualityReviewCap, 1);
  return cfg.qualityRatingWeight * star + cfg.qualityCountWeight * reviews;
}

export function noveltyScore({ timesSeen = 0, profile = {}, tags = [], rating = null }, cfg = CFG) {
  const w = cfg.weights;
  const parts = { novelty: novelty(timesSeen, cfg), unexpectedness: unexpectedness(profile, tags, cfg), quality: quality(rating, cfg) };
  return { score: w.novelty * parts.novelty + w.unexpectedness * parts.unexpectedness + w.quality * parts.quality, ...parts };
}

// ---- Exploration set ----------------------------------------------------------

// candidates: picks ({ id, region, categories }) the user could be shown.
// exclude: keys ("region/id") that exploitation will use in this set.
// seenOf(pick) -> times shown; profileOf(pick) -> { tag: score };
// ratingOf(pick) -> { avg, count } | null; trendOf(pick) -> check-ins this week.
// Buckets: never seen (50%), high-rated but atypical (30%), trending (20%),
// then filled from the rest by score. Ranked by novelty_score; top `size`.
export function explorationSet({ candidates = [], exclude = new Set(), seenOf = () => 0, profileOf = () => ({}), ratingOf = () => null, trendOf = () => 0, size = CFG.exploreSetSize, cfg = CFG }) {
  const keyOf = (p) => `${p.region || p.regionId}/${p.id}`;
  const scored = [];
  for (const p of candidates) {
    if (!p?.id || exclude.has(keyOf(p))) continue;
    const rating = ratingOf(p);
    if (rating?.count && Number(rating.avg) < cfg.minQualityRating) continue; // never explore a known-bad place
    const timesSeen = seenOf(p) || 0;
    const ns = noveltyScore({ timesSeen, profile: profileOf(p), tags: p.categories, rating }, cfg);
    scored.push({ p, ns, timesSeen, trend: trendOf(p) || 0 });
  }
  const byScore = (a, b) => b.ns.score - a.ns.score || (a.p.distanceMeters ?? 0) - (b.p.distanceMeters ?? 0);
  const taken = new Map();
  const takeFrom = (list, n, bucket) => {
    for (const x of list) {
      if (n <= 0) break;
      const k = keyOf(x.p);
      if (taken.has(k)) continue;
      taken.set(k, { ...x, bucket });
      n--;
    }
  };
  const share = (s) => Math.round(size * s);
  takeFrom(scored.filter((x) => x.timesSeen === 0).sort(byScore), share(cfg.buckets.neverSeen), 'never-seen');
  takeFrom(scored.filter((x) => x.ns.unexpectedness === cfg.unexpectedValues[0] && x.ns.quality >= cfg.qualityRatingWeight * (cfg.minQualityRating / 5)).sort(byScore), share(cfg.buckets.atypical), 'atypical');
  takeFrom(scored.filter((x) => x.trend > 0).sort((a, b) => b.trend - a.trend || byScore(a, b)), share(cfg.buckets.trending), 'trending');
  takeFrom([...scored].sort(byScore), size - taken.size, 'fill');
  return [...taken.values()]
    .sort(byScore)
    .slice(0, size)
    .map((x) => ({ ...x.p, explore: true, exploreBucket: x.bucket, noveltyScore: Math.round(x.ns.score * 1000) / 1000, timesSeen: x.timesSeen }));
}

// Which slots explore: each one independently with probability epsilon.
export function assignSlots(count, epsilon, rng = Math.random) {
  return Array.from({ length: Math.max(0, count) }, () => (rng() < epsilon ? 'explore' : 'exploit'));
}

// The weekly server-side scan: how many active users are stagnating.
// states: [{ userId, ...userState }]
export function stagnationReport(states, cfg = CFG) {
  const flagged = (states || []).filter((s) => isStagnating(s, cfg));
  const n = (states || []).length;
  return { users: n, stagnating: flagged.length, share: n ? flagged.length / n : null, flaggedIds: flagged.map((s) => s.userId) };
}
