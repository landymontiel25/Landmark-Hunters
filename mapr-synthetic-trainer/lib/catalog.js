import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LANDMARKS, registerPlaces } from '../../src/data/regions.js';
import { PLACE_PACKS } from '../../src/data/placePacks.manifest.js';
import { placeKinds } from '../../src/lib/placeKinds.js';
import { landmarkFeatures } from '../../src/lib/maprRank/similarity.js';

// The real Landmark Hunters catalog: hand-picked regions (src/data) plus
// the imported place packs (public/places), the same list the nightly job
// trains on. Synthetic users only ever see real places.

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A synthetic user lives in one trip area and meets 50 places from it, so
// an area needs well over 50 places. Small regions next to a big one join it.
export const AREAS = {
  miami: ['miami', 'key-biscayne', 'coral-gables'],
  philly: ['philly', 'villanova'],
  'san-francisco': ['san-francisco'],
  'silicon-valley': ['silicon-valley'],
  nyc: ['nyc'],
  madrid: ['madrid', 'el-escorial', 'aranjuez'],
  milan: ['milan', 'lake-como'],
};
const AREA_OF = new Map(Object.entries(AREAS).flatMap(([a, rs]) => rs.map((r) => [r, a])));

// Categories nobody rates as a trip stop.
const SKIP_CATEGORIES = new Set(['airports', 'benches', 'campus-life', 'dorms']);

const COST_FEATURE = { Free: 'cost:free', $: 'cost:$', $$: 'cost:$$', $$$: 'cost:$$$', $$$$: 'cost:$$$$' };

// Taste features of one place: the production similarity features
// (c:category, k:kind) plus price and fame, which archetypes also care about.
export function tasteFeatures(l) {
  const out = landmarkFeatures(l, placeKinds);
  const cost = COST_FEATURE[l.cost] || (l.free === true ? 'cost:free' : null);
  if (cost) out.add(cost);
  if (l.popularity >= 7) out.add('pop:famous');
  else if (l.popularity <= 1) out.add('pop:local');
  return out;
}

let cached = null;

// { places: [{ idx, id, name, region, area, categories, features:Set }],
//   byArea: { area: [idx...] }, featureIndex: Map(feature -> n) }
export async function loadCatalog() {
  if (cached) return cached;
  // Same chunks api/_lib/placePacks.js loads, read by absolute path (that
  // helper reads relative to cwd, which worker threads cannot change).
  for (const p of PLACE_PACKS) registerPlaces(JSON.parse(await readFile(path.join(REPO_ROOT, 'public', p.file), 'utf8')));
  const places = [];
  const seen = new Set();
  for (const l of ALL_LANDMARKS) {
    const area = AREA_OF.get(l.regionId);
    if (!area || seen.has(l.id)) continue;
    if ((l.categories || []).some((c) => SKIP_CATEGORIES.has(c))) continue;
    seen.add(l.id);
    places.push({
      idx: places.length,
      id: l.id,
      name: l.name,
      region: l.regionId,
      area,
      categories: [...(l.categories || [])],
      kinds: [...placeKinds(l)],
      popularity: l.popularity ?? 1,
      features: tasteFeatures(l),
      raw: l,
    });
  }
  const byArea = {};
  for (const p of places) (byArea[p.area] ||= []).push(p.idx);
  const featureCounts = new Map();
  for (const p of places) for (const f of p.features) featureCounts.set(f, (featureCounts.get(f) || 0) + 1);
  cached = { places, byArea, featureCounts };
  return cached;
}
