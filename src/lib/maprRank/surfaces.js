import { effectiveTagScores } from '../tagScores.js';
import { kindAffinity, kindBoost } from '../placeKinds.js';
import { getLandmark } from '../../data/regions.js';
import { FEATURES } from './config.js';
import { haversineKm } from './distanceDecay.js';
import { scorePicks, planExploration } from './rank.js';
import { assignSlots } from './exploration.js';

// One entry point for every Mapr surface that ranks places (CLAUDE.md: a
// Mapr change goes to all of them). The Map sheet's main picks go through
// rankNearbyCandidates (nearbyPicks.js); everything else (its other rows,
// Travel Picks, the trip planner, the landmark list's "For Me" order, Mapr
// chat on the server) calls rankPlaces here, so all of them share:
//   Week 1 distance decay, Week 2 similarity boost, Week 3 NCF (once
//   switched on), Week 4 exploration (for surfaces that show a pick set).

const keyOf = (l) => `${l.regionId || l.region}/${l.id}`;

// The taste fit of one place: its categories' effective tag scores plus the
// kind-of-place boost (placeKinds.js), the same inputs as the Map sheet.
export function tasteScorer({ profile = null, myReviews = {}, now = Date.now(), findLandmark = (r) => getLandmark(r.region, r.landmarkId) || null } = {}) {
  const cache = new Map();
  const scoresFor = (region) => {
    if (!cache.has(region)) cache.set(region, profile ? effectiveTagScores(profile, region, now) : {});
    return cache.get(region);
  };
  const affinity = kindAffinity(myReviews, findLandmark);
  return (l) => {
    const s = scoresFor(l.regionId || l.region);
    const tag = (l.categories || []).reduce((sum, c) => sum + (s[c] || 0), 0);
    return Math.round((tag + kindBoost(l, affinity)) * 10) / 10;
  };
}

// Ranks `places` (landmark objects) for one user and returns:
//   ranked   every place, best first, each with finalScore + telemetry
//   picks    the first `count` after exploration (when count is given and
//            the user is in the exploration rollout), else ranked.slice(0, count)
//   meta     variants, fallbacks, latency; exploration: the plan or null
// Options:
//   scoreOf(place)  taste fit; defaults to tasteScorer(...)
//   origin          { lat, lng } to measure distance (no origin: no decay)
//   explore         exploration context (see rank.js planExploration)
//   rng             random source for exploration slots
export function rankPlaces({ places = [], uid = null, profile = null, myReviews = {}, origin = null, models = null, visitedIds = null, now = Date.now(), features = FEATURES, scoreOf = null, count = null, explore = null, rng = Math.random }) {
  const fit = scoreOf || tasteScorer({ profile, myReviews, now });
  const candidates = places.map((l) => {
    const km = origin && Number.isFinite(l.lat) && Number.isFinite(l.lng) ? haversineKm(origin.lat, origin.lng, l.lat, l.lng) : null;
    return { ...l, region: l.regionId || l.region, regionId: l.regionId || l.region, tagScore: fit(l), distanceMeters: km == null ? (l.distanceMeters ?? null) : km * 1000 };
  });
  const scored = scorePicks({ usual: candidates, uid, myReviews, models, visitedIds, features });
  // Ties keep the incoming order (callers pass a meaningful default order).
  const order = new Map(candidates.map((c, i) => [keyOf(c), i]));
  const ranked = scored.usual.sort((a, b) => b.finalScore - a.finalScore || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0) || order.get(keyOf(a)) - order.get(keyOf(b)));
  let exploration = null;
  if (count != null && uid) {
    try {
      exploration = planExploration({
        uid,
        usual: ranked,
        features,
        ctx: { myReviews, now, profileOf: (region) => (profile ? effectiveTagScores(profile, region, now) : {}), trendOf: (p) => models?.signals?.trending?.[keyOf(p)] || 0, ...(explore || {}), ratingOf: (p) => explore?.ratings?.[p.id] || null },
      });
    } catch {
      scored.meta.fallbacks.push('exploration-error');
    }
  }
  const picks = count == null ? ranked : exploration ? mixExploration(ranked, exploration, count, rng) : ranked.slice(0, count);
  return { ranked, picks: withSetTelemetry(picks, scored.meta, exploration), meta: { ...scored.meta, exploration } };
}

// Fills `count` slots: each explores with probability epsilon (taking the
// next exploration pick), the rest take the best remaining ranked place.
export function mixExploration(ranked, exploration, count, rng = Math.random) {
  const used = new Set();
  const take = (queue) => {
    const p = queue.find((x) => !used.has(keyOf(x)));
    if (p) used.add(keyOf(p));
    return p || null;
  };
  const out = [];
  for (const slot of assignSlots(count, exploration.epsilon, rng)) {
    const explored = slot === 'explore' ? take(exploration.explore) : null;
    const p = explored || take(ranked) || take(exploration.explore);
    if (!p) break;
    out.push(explored ? { ...p, slot: 'explore' } : { ...p, slot: 'exploit' });
  }
  return out;
}

// The set-level part of the telemetry (logged with each shown pick).
export function withSetTelemetry(picks, meta, exploration) {
  return picks.map((p, i) => ({
    ...p,
    telemetry: {
      ...(p.telemetry || {}),
      variants: meta.variants,
      fallbacks: meta.fallbacks,
      rankLatencyMs: meta.latencyMs,
      epsilon: exploration ? exploration.epsilon : null,
      epsilonReason: exploration ? exploration.reason : null,
      rankPosition: i + 1,
      explore: p.slot === 'explore',
      noveltyScore: p.slot === 'explore' ? p.noveltyScore ?? null : null,
    },
  }));
}

// A pick as the shown-logger wants it (id, region, name, categories, rank,
// telemetry).
export const loggable = (p, rank) => ({ id: p.id, region: p.regionId || p.region, name: p.name, categories: p.categories || [], rank, ...(p.telemetry ? { telemetry: p.telemetry } : {}) });
