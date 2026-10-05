// Step 3: apply the import rules (category, facts, closed / unnamed /
// duplicate drops) to the pulled data, and for a region with a `select` rule
// (regions.js, select.js) keep only the chosen places.
//   node scripts/osm-import/stage.mjs [--region philly]   (default miami)
// Writes data/<region>/staged.json (places) and dropped.json (every drop + why).
import fs from 'node:fs';
import { ALL_LANDMARKS } from '../../src/data/regions.js';
import { importPlaces, insideShape, okWebFact } from './transform.js';
import { regionFromArgs } from './regions.js';
import { selectPlaces, selectCurated } from './select.js';

const region = regionFromArgs(process.argv);
const DIR = region.dataDir;
const { elements, osm3s } = JSON.parse(fs.readFileSync(`${DIR}/osm.json`, 'utf8'));
const wikidataFacts = fs.existsSync(`${DIR}/wikidata-facts.json`) ? JSON.parse(fs.readFileSync(`${DIR}/wikidata-facts.json`, 'utf8')) : {};
// Only the hand-curated catalog: places already imported must not count as
// duplicates of themselves.
const catalog = ALL_LANDMARKS.filter((l) => l.source !== 'osm');
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
// A region pulled part by part (regions.js `parts`) keeps what each part's
// pull returned, inside the outer shape.
const inside = region.parts ? (lat, lng, el) => !!el.town && insideShape(lat, lng, region.shape) : null;
const townOf = new Map(elements.map((el) => [`osm-${el.type[0]}${el.id}`, el.town]));
const imported = importPlaces(elements, { catalog, wikidataFacts, overrides, region: region.id, shape: region.shape, inside });
const dropped = imported.dropped;
// `_area` (a town or nearest neighborhood) is for the spread and the report
// only; build-packs.mjs leaves underscore fields out of the packs.
// A located candidate (locate-candidates.mjs) also carries its research
// tier and, for an insider pick, the sourced tech link (`_tier`, `_reason`).
const researchOf = new Map(elements.filter((el) => el.research).map((el) => [`osm-${el.type[0]}${el.id}`, el.research]));
let places = imported.places.map((p) => ({
  ...p,
  region: region.packRegionOf(p.lat, p.lng),
  ...(region.parts || region.areaOf ? { _area: townOf.get(p.id) || region.areaOf?.(p.lat, p.lng) || null } : {}),
  ...(researchOf.has(p.id) ? { _tier: researchOf.get(p.id).tier, _reason: researchOf.get(p.id).reason } : {}),
}));
if (region.curated) {
  const tagsById = new Map(elements.map((el) => [`osm-${el.type[0]}${el.id}`, el.tags || {}]));
  const webFacts = JSON.parse(fs.readFileSync('scripts/osm-import/web-facts.json', 'utf8'));
  const webFactsOf = (p) => (webFacts[p.id]?.facts || []).filter(okWebFact).length;
  const { selected, notSelected, tiers } = selectCurated(places, { tagsById, overrides, ...region.curated, webFactsOf, areaOf: (p) => p._area });
  places = selected;
  dropped.notSelected = notSelected.map((p) => ({ id: p.id, name: p.name, category: p.categories[0], why: p.why }));
  console.log('selected by tier:', tiers);
  console.log('selected by area:', Object.fromEntries(Object.entries(Object.groupBy(places, (p) => p._area)).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])));
} else if (region.select) {
  const tagsById = new Map(elements.map((el) => [`osm-${el.type[0]}${el.id}`, el.tags || {}]));
  const { selected, notSelected, tiers } = selectPlaces(places, { tagsById, overrides, ...region.select });
  places = selected;
  dropped.notSelected = notSelected.map((p) => ({ id: p.id, name: p.name, category: p.categories[0], why: p.why }));
  console.log('selected by tier:', tiers);
}
fs.writeFileSync(`${DIR}/staged.json`, JSON.stringify(places, null, 1));
fs.writeFileSync(`${DIR}/dropped.json`, JSON.stringify({ osmBase: osm3s?.timestamp_osm_base, ...dropped }, null, 1));

const count = (key) => {
  const out = {};
  for (const p of places) out[key(p)] = (out[key(p)] || 0) + 1;
  return out;
};
console.log('staged by category:', count((p) => p.categories[0]), 'total', places.length);
if (region.packRegions.length > 1) console.log('staged by app region:', count((p) => p.region));
console.log('dropped:', Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, v.length])));
