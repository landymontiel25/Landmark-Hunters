import { computeRegionSimilarity, encodeNeighbors, landmarkFeatures } from '../src/lib/maprRank/similarity.js';
import { placeKinds } from '../src/lib/placeKinds.js';

// Item-item similarity with the production code (similarity.js): per
// region, 0.6 * Jaccard of who liked both + 0.4 * cosine of category/kind
// features, top 20 neighbors per place. Production feeds it real check-ins;
// here the "visits" are the synthetic training positives.

const NOW = Date.UTC(2026, 9, 1);

// positives: [{ userId, place }]
export function computeSimilarity(catalog, positives) {
  const visitsByRegion = new Map();
  for (const { userId, place } of positives) {
    if (!visitsByRegion.has(place.region)) visitsByRegion.set(place.region, []);
    visitsByRegion.get(place.region).push({ userId, landmarkId: place.id, at: NOW });
  }
  const byRegion = new Map();
  for (const p of catalog.places) {
    if (!byRegion.has(p.region)) byRegion.set(p.region, []);
    byRegion.get(p.region).push({ id: p.id, features: landmarkFeatures(p.raw, placeKinds) });
  }
  const regions = {};
  const stats = {};
  let ms = 0;
  for (const [region, landmarks] of byRegion) {
    const res = computeRegionSimilarity({ visits: visitsByRegion.get(region) || [], landmarks, now: NOW });
    regions[region] = res.neighbors;
    stats[region] = res.stats;
    ms += res.stats.ms;
  }
  return { regions, stats, ms };
}

// Size of the matrix as production would store it (one JSON string per region).
export function matrixBytes(regions) {
  let bytes = 0;
  for (const n of Object.values(regions)) bytes += encodeNeighbors(n).json.length;
  return bytes;
}
