import { canonicalRegionId, getLandmark } from '../../src/data/regions.js';

// A catalog landmark whose name or map pin doesn't line up with its Google
// listing (the Abacos: "Nippers" is "Nipper's Beach Bar & Grill" on Google,
// and a few pins sit on the nearest point OpenStreetMap maps) names that
// listing in `googleMatch: { name, withinMeters }`. The photo and ratings
// lookups then search Google for that name and accept a match that far
// from the pin, with the same strict name check. Read from the catalog
// itself, never from the request, and only when the request names the
// landmark by its catalog name.
export function googleMatchFor(region, id, name) {
  const l = getLandmark(canonicalRegionId(String(region || '')), String(id || ''));
  const g = l?.googleMatch;
  if (!g || typeof g.name !== 'string' || !(g.withinMeters > 0) || l.name !== String(name || '').trim()) return null;
  return { name: g.name, withinMeters: Math.min(g.withinMeters, 5000) };
}
