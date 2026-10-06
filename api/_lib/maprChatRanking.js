import { rankPlaces } from '../../src/lib/maprRank/surfaces.js';
import { haversineKm } from '../../src/lib/maprRank/distanceDecay.js';
import { seededRandom } from '../../src/lib/maprRank/experiments.js';

// Mapr chat (api/plan-ai.js) with the same Phase 1 ranking as every other
// Mapr surface: the candidate places are ranked in code (taste x distance x
// similar places x the model once on, with exploration slots) and the top of
// that list goes into the prompt, so Claude chooses from Mapr's order instead
// of the bare catalog. Group requests get no block (no personal taste).

export const CHAT_RANKED_COUNT = 15;
export const CHAT_NEAR_KM = 80;
const TIERS = new Set(['highly-recommend', 'worth-trying', 'probably-skip']);
const str = (v, n) => String(v ?? '').slice(0, n);

// The client's reviews (with landmarkId/region since this change) as the
// myReviews map the ranking reads, plus the ids already visited.
export function reviewsMap(reviews) {
  const out = {};
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const id = str(r?.landmarkId, 120);
    if (!id || !TIERS.has(r?.tier)) continue;
    out[id] = { landmarkId: id, region: str(r.region, 40) || null, ratingTier: r.tier, visited: r.visited !== false };
  }
  return out;
}

// Taste fit from the summary the client sends: { all: {tag: score} } or per city.
export function summaryScorer(tagScoreSummary) {
  const s = tagScoreSummary && typeof tagScoreSummary === 'object' ? tagScoreSummary : {};
  return (l) => {
    const tags = s.all || s[l.regionId] || {};
    return (l.categories || []).reduce((sum, c) => sum + (Number(tags[c]) || 0), 0);
  };
}

// Returns { text, telemetry: { "region/id": {...} }, ids: Set } or null.
export function chatRanking({ uid, pool = [], curated = [], regionsChosen = false, near = null, tagScoreSummary = {}, reviews = [], maprContext = null, models = null, now = Date.now(), requestFor = 'solo', count = CHAT_RANKED_COUNT, rng = null }) {
  if (requestFor === 'group') return null;
  const candidates = regionsChosen
    ? pool
    : near
    ? curated.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng) && haversineKm(near.lat, near.lng, l.lat, l.lng) <= CHAT_NEAR_KM)
    : [];
  if (!candidates.length) return null;
  const myReviews = reviewsMap(reviews);
  const visited = new Set(Object.values(myReviews).filter((r) => r.visited).map((r) => r.landmarkId));
  const places = candidates.filter((l) => !visited.has(l.id));
  const fit = summaryScorer(tagScoreSummary);
  const ctx = maprContext && typeof maprContext === 'object' ? maprContext : {};
  const shown = {};
  for (const [id, n] of Object.entries(ctx.seen && typeof ctx.seen === 'object' ? ctx.seen : {}).slice(0, 500)) {
    if (Number.isFinite(Number(n))) shown[str(id, 120)] = { count: Number(n), lastShownAt: now, firstShownAt: now };
  }
  const { picks } = rankPlaces({
    places,
    uid,
    myReviews,
    origin: near,
    models,
    now,
    scoreOf: fit,
    count,
    explore: { createdAtMs: Number.isFinite(Number(ctx.createdAtMs)) ? Number(ctx.createdAtMs) : null, shown, serverStagnating: models?.serverStagnating === true, profileOf: () => (tagScoreSummary?.all || {}) },
    rng: rng || seededRandom(`${uid}|${now}`),
  });
  if (!picks.length) return null;
  const telemetry = {};
  const lines = picks.map((p) => {
    const key = `${p.regionId}/${p.id}`;
    telemetry[key] = p.telemetry;
    const km = p.telemetry?.distanceKm;
    return `${key} | ${p.name} | ${p.categories?.[0] || ''}${km != null ? ` | ${km < 1 ? '<1' : Math.round(km)} km` : ''}${p.slot === 'explore' ? ' | NEW FOR YOU' : ''}`;
  });
  const text =
    "MAPR'S RANKING FOR THIS TRAVELER (Mapr's own scoring: their taste, how close each place is, places loved by travelers " +
    'with similar taste, and its learned model; best fit first; already-visited places left out):\n' +
    lines.join('\n') +
    '\nUse it: when the request is open-ended ("what should I do", "plan my afternoon", "something near me"), choose catalog ' +
    'stops from the top of this list, in this order, unless a stop clearly does not fit what they asked. A line marked NEW FOR ' +
    'YOU is deliberate exploration (a place they have not seen that is still well rated); include one of those when one fits. ' +
    'When they ask for something specific, follow the ask and use the catalog as usual.';
  return { text, telemetry, ids: new Set(Object.keys(telemetry)) };
}
