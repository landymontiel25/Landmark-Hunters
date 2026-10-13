import { effectiveTagScores } from '../tagScores.js';
import { canonicalRegionId } from '../../data/regions.js';

// Taste neighbors (docs/discovery-network-plan.md, steps 1 to 4). Pure, so
// the nightly job (api/_lib/neighborsJob.js), the phone and the server
// Mapr loaders all agree. Nobody ever sees a number from here: profiles
// show tasteMatchLabel's "High" or "Some", or nothing.

export const NEIGHBOR_FLOOR = 0.3; // (v2) below this a person is not a neighbor
export const NEIGHBOR_HIGH = 0.6;
export const FULL_TRUST_RATINGS = 10; // step 2 shrink
export const AGREE_MIN_SHARED = 3; // step 3
export const AGREE_FULL_SHARED = 10;
export const TOP_NEIGHBORS = 50;
export const TASTE_WEIGHT = 0.6;
export const AGREE_WEIGHT = 0.4;
// A region id no account rates in: effectiveTagScores then lends every
// region's taste at full weight, so this is the person's overall taste.
const OVERALL = '__overall__';

// Step 1: the taste vector, effectiveTagScores / 100 (the 1.5x "lean into
// it" boost included). region null = the overall taste across cities.
export function tasteVector(profile, region = null, nowMs = Date.now()) {
  const scores = region ? effectiveTagScores(profile, region, nowMs) : effectiveTagScores(profile, OVERALL, nowMs, { warmStartWeight: 1 });
  const out = {};
  for (const [tag, v] of Object.entries(scores)) if (Number.isFinite(v) && v !== 0) out[tag] = v / 100;
  return out;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a)) {
    na += v * v;
    if (k in b) dot += v * b[k];
  }
  for (const v of Object.values(b)) nb += v * v;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

const shrink = (n, full) => Math.min(1, Math.max(0, n) / full);

// Step 2: cosine, shrunk toward 0 when either person has under 10 ratings,
// so a new account can't look like a perfect match.
export function tasteSim(vecA, vecB, ratingsA, ratingsB) {
  return cosine(vecA, vecB) * shrink(ratingsA, FULL_TRUST_RATINGS) * shrink(ratingsB, FULL_TRUST_RATINGS);
}

// Step 3: rating agreement on places both rated, scored like pair streaks:
// same answer 1, adjacent 0.5, opposite 0. Null under 3 shared places;
// shrinks toward 0 below 10.
const LEVEL = { 'highly-recommend': 2, 'worth-trying': 1, 'probably-skip': 0 };
export function agreement(tiersA, tiersB) {
  let sum = 0;
  let shared = 0;
  for (const [place, tier] of Object.entries(tiersA)) {
    if (!(place in tiersB) || !(tier in LEVEL) || !(tiersB[place] in LEVEL)) continue;
    const gap = Math.abs(LEVEL[tier] - LEVEL[tiersB[place]]);
    sum += gap === 0 ? 1 : gap === 1 ? 0.5 : 0;
    shared++;
  }
  if (shared < AGREE_MIN_SHARED) return null;
  return (sum / shared) * shrink(shared, AGREE_FULL_SHARED);
}

// Step 4: 0.6 taste + 0.4 agreement; taste alone with no agreement.
export function neighborScore(sim, agree) {
  return agree == null ? sim : TASTE_WEIGHT * sim + AGREE_WEIGHT * agree;
}

// (v2) A weak match counts for nothing.
export const isNeighbor = (score) => Number.isFinite(score) && score >= NEIGHBOR_FLOOR;

// What a profile shows. Never the number.
export function tasteMatchLabel(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= NEIGHBOR_HIGH) return 'High';
  if (score >= NEIGHBOR_FLOOR) return 'Some';
  return null;
}

// One person's neighbors among `candidates`, best first, top 50, floor
// applied. people: { uid -> { vector, ratings, tiers } } for that city (or
// overall). skip(uid): true for anyone who must not be a neighbor (a block
// either way).
// canSeeRatings(uid): may this person read that candidate's ratings (their
// profile is public, or they're friends)? When not, agreement stays out and
// the score is taste alone: the score (readable by its owner) must never
// reveal a rating the owner couldn't read anyway.
export function rankNeighbors(uid, people, candidates, { skip = () => false, top = TOP_NEIGHBORS, canSeeRatings = () => true } = {}) {
  const me = people[uid];
  if (!me) return [];
  const out = [];
  for (const c of candidates) {
    if (c === uid || skip(c)) continue;
    const them = people[c];
    if (!them) continue;
    const agree = canSeeRatings(c) ? agreement(me.tiers, them.tiers) : null;
    const score = neighborScore(tasteSim(me.vector, them.vector, me.ratings, them.ratings), agree);
    if (isNeighbor(score)) out.push({ uid: c, score: Math.round(score * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score || (a.uid < b.uid ? -1 : 1)).slice(0, top);
}

// A neighbors doc (mapr_neighbors/{uid}) read for one person: their score
// in this city's list, else the overall list, else null.
export function neighborScoreOf(doc, otherUid, region = null) {
  if (!doc || !otherUid) return null;
  const pick = (list) => (Array.isArray(list) ? list.find((n) => n.uid === otherUid)?.score ?? null : null);
  // Lists are keyed by the canonical region (an old id folded into Miami
  // reads Miami's).
  return (region && pick(doc.byRegion?.[canonicalRegionId(region)])) ?? pick(doc.global);
}

// mapr_neighbors/{uid} as the Mapr loaders hand it to ranking: lists of
// { uid, score }, the overall one and one per city. Anything malformed is
// dropped; a missing doc is null.
export function neighborsFromDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const clean = (list) => (Array.isArray(list) ? list.filter((n) => n && typeof n.uid === 'string' && isNeighbor(n.score)).map((n) => ({ uid: n.uid, score: n.score })) : []);
  const byRegion = {};
  for (const [r, list] of Object.entries(d.byRegion && typeof d.byRegion === 'object' ? d.byRegion : {})) byRegion[r] = clean(list);
  return { global: clean(d.global), byRegion };
}
