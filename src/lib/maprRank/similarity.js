import {
  COLLAB_BOOST_PER_SIMILARITY,
  COLLAB_MAX_BOOST,
  COSINE_WEIGHT,
  JACCARD_WEIGHT,
  SIMILAR_TOP_K,
  SIMILARITY_DOC_MAX_CHARS,
  SIMILARITY_MIN,
  SIMILARITY_WINDOW_DAYS,
} from './config.js';

// Week 2: item-item collaborative filtering, one region at a time.
//
//   jaccard(A, B) = co_visitors / (visitors_A + visitors_B - co_visitors)
//   cosine(A, B)  = |features_A ∩ features_B| / sqrt(|features_A| * |features_B|)
//                   (binary vectors: categories + kinds of place)
//   similarity    = JACCARD_WEIGHT * jaccard + COSINE_WEIGHT * cosine
//
// Only the top SIMILAR_TOP_K neighbors of each landmark are kept (a sparse
// matrix), and only for landmarks someone has interacted with: a boost is
// always looked up from a landmark the user liked, so a row nobody could
// have liked is never read. Pure functions; the nightly job feeds them.

const DAY_MS = 24 * 60 * 60 * 1000;

export function jaccard(coVisitors, visitorsA, visitorsB) {
  const union = visitorsA + visitorsB - coVisitors;
  return union > 0 && coVisitors > 0 ? coVisitors / union : 0;
}

// Cosine of two binary feature sets.
export function setCosine(a, b) {
  if (!a?.size || !b?.size) return 0;
  let shared = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const f of small) if (big.has(f)) shared++;
  return shared / Math.sqrt(a.size * b.size);
}

export const blendSimilarity = (jac, cos) => JACCARD_WEIGHT * jac + COSINE_WEIGHT * cos;

// visits: [{ userId, landmarkId, at }] for ONE region (check-ins).
// landmarks: [{ id, features: Set<string> }] for the same region.
// rowOwners: extra landmark ids that need a row even with no visit (places
// someone rated highly without checking in).
// Returns { neighbors: { [id]: [[otherId, similarity], ...] }, stats }.
export function computeRegionSimilarity({ visits = [], landmarks = [], rowOwners = [], now = Date.now(), windowDays = SIMILARITY_WINDOW_DAYS, topK = SIMILAR_TOP_K }) {
  const started = Date.now();
  const since = now - windowDays * DAY_MS;
  const known = new Map(landmarks.map((l) => [l.id, l.features instanceof Set ? l.features : new Set(l.features || [])]));
  const visitorsOf = new Map();
  const placesOf = new Map();
  for (const v of visits) {
    if (!v?.userId || !v?.landmarkId || !known.has(v.landmarkId)) continue;
    if (Number.isFinite(v.at) && v.at < since) continue;
    if (!visitorsOf.has(v.landmarkId)) visitorsOf.set(v.landmarkId, new Set());
    visitorsOf.get(v.landmarkId).add(v.userId);
    if (!placesOf.has(v.userId)) placesOf.set(v.userId, new Set());
    placesOf.get(v.userId).add(v.landmarkId);
  }
  // Inverted index feature -> landmarks, so cosine only visits places that
  // share at least one feature.
  const byFeature = new Map();
  for (const [id, feats] of known) {
    for (const f of feats) {
      if (!byFeature.has(f)) byFeature.set(f, []);
      byFeature.get(f).push(id);
    }
  }
  const owners = new Set([...visitorsOf.keys(), ...rowOwners.filter((id) => known.has(id))]);
  const neighbors = {};
  let pairs = 0;
  for (const a of owners) {
    const visA = visitorsOf.get(a);
    const co = new Map();
    for (const u of visA || []) {
      for (const b of placesOf.get(u)) if (b !== a) co.set(b, (co.get(b) || 0) + 1);
    }
    const candidates = new Set(co.keys());
    for (const f of known.get(a)) for (const b of byFeature.get(f)) if (b !== a) candidates.add(b);
    const scored = [];
    for (const b of candidates) {
      pairs++;
      const jac = jaccard(co.get(b) || 0, visA?.size || 0, visitorsOf.get(b)?.size || 0);
      const cos = setCosine(known.get(a), known.get(b));
      const s = blendSimilarity(jac, cos);
      if (s >= SIMILARITY_MIN) scored.push([b, Math.round(s * 10000) / 10000]);
    }
    scored.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    if (scored.length) neighbors[a] = scored.slice(0, topK);
  }
  return {
    neighbors,
    stats: { landmarks: known.size, rows: Object.keys(neighbors).length, visitors: placesOf.size, pairs, ms: Date.now() - started },
  };
}

// Firestore stores the matrix as one JSON string. A matrix too big for one
// document drops the weakest neighbors of every row until it fits.
export function encodeNeighbors(neighbors, maxChars = SIMILARITY_DOC_MAX_CHARS) {
  let k = Math.max(0, ...Object.values(neighbors).map((r) => r.length));
  for (;;) {
    const trimmed = Object.fromEntries(Object.entries(neighbors).map(([id, row]) => [id, row.slice(0, k)]));
    const json = JSON.stringify(trimmed);
    if (json.length <= maxChars || k <= 1) return { json, keptPerRow: k };
    k -= Math.max(1, Math.ceil(k * 0.2));
  }
}

export function decodeNeighbors(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json) : json;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// similarity(a, b) from the sparse matrix, either direction (only the top
// 20 of each row are stored, so b may sit in a's row but not a in b's).
export function lookupSimilarity(neighbors, a, b) {
  let best = 0;
  for (const [x, y] of [[a, b], [b, a]]) {
    const row = neighbors?.[x];
    if (!Array.isArray(row)) continue;
    for (const [id, s] of row) if (id === y && s > best) best = s;
  }
  return best;
}

// boost = sum over liked landmarks of similarity * COLLAB_BOOST_PER_SIMILARITY,
// capped at COLLAB_MAX_BOOST. The score is then multiplied by (1 + boost).
// likedIds never includes the candidate itself.
export function collabBoost(neighbors, candidateId, likedIds) {
  if (!neighbors || !likedIds?.length) return 0;
  let boost = 0;
  for (const liked of likedIds) {
    if (liked === candidateId) continue;
    boost += lookupSimilarity(neighbors, liked, candidateId) * COLLAB_BOOST_PER_SIMILARITY;
    if (boost >= COLLAB_MAX_BOOST) return COLLAB_MAX_BOOST;
  }
  return Math.round(boost * 10000) / 10000;
}

// The binary feature set behind cosine: each category and each kind of place.
export function landmarkFeatures(l, kindsOf = () => new Set()) {
  const out = new Set((l?.categories || []).map((c) => `c:${c}`));
  for (const k of kindsOf(l)) out.add(`k:${k}`);
  return out;
}
