import { FEATURES, NCF as NCF_CFG, EXPLORATION as EXPLORE_CFG, COLLAB_LIKED_MIN_STARS } from './config.js';
import { applyDecay, decayMultiplier } from './distanceDecay.js';
import { collabBoost } from './similarity.js';
import { prepareScorer } from './ncf.js';
import { variantsFor } from './experiments.js';
import { epsilonFor, explorationSet, isStagnating, userState } from './exploration.js';

// Mapr Phase 1 scoring, on top of the tag-score queues from
// rankNearbyCandidates (src/lib/nearbyPicks.js):
//
//   Week 1  after_decay = tag_score * 1 / (1 + km / 1.5)
//   Week 2  base        = after_decay * (1 + item_item_boost)      (boost <= 0.2)
//   Week 3  final       = 0.4 * base / max(base) + 0.6 * ncf       (NCF treatment)
//   Week 4  each slot explores with probability epsilon            (exploration treatment)
//
// Every step has its own feature flag (config.js FEATURES) and its own
// fallback: a missing or broken model, or a step over its time budget, drops
// back to the step before, and the request still returns picks. What happened
// is written on each pick as `telemetry` (logged with the shown row).

const TIER_STARS = { 'highly-recommend': 5, 'worth-trying': 3, 'probably-skip': 1 };
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const round = (x, dp = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
const keyOf = (p) => `${p.region || p.regionId}/${p.id}`;

// The pre-Phase-1 distance rule (a linear penalty per mile), kept for users
// outside the decay rollout so the comparison stays clean.
export const LEGACY_PENALTY_PER_MILE = 1.5;
const METERS_PER_MILE = 1609.34;
const legacyScore = (p) => (p.tagScore || 0) - ((p.distanceMeters || 0) / METERS_PER_MILE) * LEGACY_PENALTY_PER_MILE;

// Liked landmarks per region: ratings at COLLAB_LIKED_MIN_STARS or more.
export function likedByRegion(myReviews) {
  const out = {};
  for (const r of Object.values(myReviews || {})) {
    if (!r?.landmarkId || (TIER_STARS[r.ratingTier] || 0) < COLLAB_LIKED_MIN_STARS) continue;
    const region = r.region || '';
    (out[region] ||= []).push(r.landmarkId);
  }
  return out;
}

// In-memory NCF scores from the last request, served when inference runs
// over its budget (the "cached scores from the previous batch" fallback).
const ncfCache = new Map();
export const _resetNcfCache = () => ncfCache.clear();

// Scores both queues. Returns new arrays, best first, each pick carrying
// `finalScore` and `telemetry`, plus the request-level `meta`.
export function scorePicks({ usual = [], fresh = [], uid = null, myReviews = {}, models = null, visitedIds = null, features = FEATURES, clock = now }) {
  const started = clock();
  const variants = variantsFor(uid, features);
  const fallbacks = [];
  const on = (f) => variants[f] === 'treatment';
  const liked = likedByRegion(myReviews);
  const visited = visitedIds instanceof Set ? visitedIds : new Set(visitedIds || []);
  const all = [...usual.map((p) => ({ p, q: 'usual' })), ...fresh.map((p) => ({ p, q: 'fresh' }))];

  const rows = all.map(({ p, q }) => {
    const before = Number.isFinite(p.tagScore) ? p.tagScore : 0;
    const km = Number.isFinite(p.distanceMeters) ? p.distanceMeters / 1000 : null;
    const afterDecay = on('distanceDecay') ? applyDecay(before, km) : legacyScore(p);
    let boost = 0;
    if (on('itemSimilarity')) {
      try {
        const neighbors = models?.similarity?.[p.region];
        if (neighbors) boost = collabBoost(neighbors, p.id, (liked[p.region] || []).filter((id) => id !== p.id));
      } catch {
        boost = 0;
        if (!fallbacks.includes('similarity-error')) fallbacks.push('similarity-error');
      }
    }
    const base = afterDecay >= 0 ? afterDecay * (1 + boost) : afterDecay / (1 + boost);
    return { p, q, before, km, afterDecay, boost, base, ncf: null };
  });

  // Week 3: NCF treatment only, and only with a model that knows this user.
  let ncfUsed = false;
  if (on('ncf')) {
    const ncfStart = clock();
    let scorer = null;
    try {
      scorer = models?.ncf && models?.userEmbedding ? prepareScorer(models.ncf, models.userEmbedding) : null;
    } catch {
      scorer = null;
    }
    if (!scorer) fallbacks.push(models?.ncf ? 'ncf-no-user' : 'ncf-no-model');
    else {
      let overBudget = false;
      for (const r of rows) {
        const k = `${uid}|${keyOf(r.p)}`;
        if (!overBudget && clock() - ncfStart > NCF_CFG.maxInferenceMs) overBudget = true;
        if (overBudget) {
          r.ncf = ncfCache.has(k) ? ncfCache.get(k) : null;
          continue;
        }
        try {
          r.ncf = scorer.score(keyOf(r.p));
          if (r.ncf != null) ncfCache.set(k, r.ncf);
        } catch {
          r.ncf = null;
        }
      }
      if (overBudget) fallbacks.push('ncf-latency');
      const scored = rows.filter((r) => r.ncf != null);
      if (scored.length) {
        ncfUsed = true;
        // A place the model has no embedding for gets the average NCF score,
        // so it is neither pushed up nor down by the model's silence.
        const mean = scored.reduce((s, r) => s + r.ncf, 0) / scored.length;
        for (const r of rows) if (r.ncf == null) r.ncfImputed = mean;
      } else fallbacks.push('ncf-no-items');
    }
    if (ncfCache.size > 5000) ncfCache.clear();
    if (clock() - ncfStart > NCF_CFG.maxInferenceMs && !fallbacks.includes('ncf-latency')) fallbacks.push('ncf-slow');
  }

  const maxBase = Math.max(0, ...rows.map((r) => r.base));
  for (const r of rows) {
    if (ncfUsed) {
      const norm = maxBase > 0 ? Math.max(0, r.base) / maxBase : 0;
      r.final = NCF_CFG.baseWeight * norm + NCF_CFG.ncfWeight * (r.ncf ?? r.ncfImputed);
    } else r.final = r.base;
  }

  const latencyMs = round(clock() - started, 2);
  const out = { usual: [], fresh: [] };
  for (const r of rows) {
    const telemetry = {
      scoreBeforeDecay: round(r.before),
      distanceKm: round(r.km, 3),
      decayMultiplier: on('distanceDecay') && r.km != null ? round(decayMultiplier(r.km)) : null,
      scoreAfterDecay: round(r.afterDecay),
      collabBoost: round(r.boost),
      ncfScore: round(r.ncf),
      finalScore: round(r.final),
      revisit: visited.has(r.p.id),
    };
    out[r.q].push({ ...r.p, finalScore: r.final, telemetry });
  }
  const best = (a, b) => b.finalScore - a.finalScore || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
  out.usual.sort(best);
  out.fresh.sort(best);
  return { ...out, meta: { variants, fallbacks, latencyMs, ncfUsed } };
}

// Week 4: the exploration side of one request. Null for users outside the
// exploration treatment.
//   ctx: { myReviews, createdAtMs, shown, votes, now, profileOf, ratingOf, trendOf, serverStagnating }
export function planExploration({ uid, usual = [], fresh = [], features = FEATURES, ctx = {}, cfg = EXPLORE_CFG }) {
  const variants = variantsFor(uid, features);
  if (variants.exploration !== 'treatment') return null;
  const state = userState({ myReviews: ctx.myReviews, createdAtMs: ctx.createdAtMs, shown: ctx.shown, votes: ctx.votes, now: ctx.now ?? Date.now(), cfg });
  // Stagnating (on this device's own history, or flagged by the nightly
  // scan): exploration goes to its maximum, 50%.
  const stagnating = isStagnating(state, cfg) || ctx.serverStagnating === true;
  const rule = epsilonFor(state, cfg);
  const epsilon = stagnating ? cfg.maxEpsilon : rule.epsilon;
  const reason = stagnating ? 'stagnating' : rule.reason;
  const exploit = [...usual, ...fresh].slice(0, cfg.exploitTop);
  const exclude = new Set(exploit.slice(0, cfg.exploreExcludeTopExploit).map(keyOf));
  const seen = ctx.shown || {};
  const set = explorationSet({
    candidates: [...usual, ...fresh],
    exclude,
    seenOf: (p) => seen[p.id]?.count || 0,
    profileOf: (p) => ctx.profileOf?.(p.region) || {},
    ratingOf: (p) => ctx.ratingOf?.(p) || null,
    trendOf: (p) => ctx.trendOf?.(p) || 0,
    cfg,
  });
  return { epsilon, reason, stagnating, state, exploit, explore: set };
}
