// For research agents: is this place in OpenStreetMap, and where? Prints the
// named matches Nominatim finds inside the region (name, kind, address), so
// an agent spends its web searches only on places the import can locate.
//   node scripts/osm-import/osm-check.mjs --region sf "Zuni Cafe" ["Another name" ...]
// Shares locate-candidates.mjs's cache and its one-request-a-second limit.
import { regionFromArgs } from './regions.js';
import { nominatim } from './nominatim.mjs';
import { areaOf, viewbox, nameMatches, core } from './locate.js';
import { normName } from '../../src/lib/placeMatch.js';

const region = regionFromArgs(process.argv);
const names = process.argv.slice(2);
const box = viewbox(region.shape);
for (const name of names) {
  const qs = [name, core(name) !== normName(name) && core(name).length >= 4 && core(name)].filter(Boolean);
  const seen = new Set();
  const hits = [];
  for (const q of qs)
    for (const r of await nominatim(`${region.dataDir}/nominatim`, { q, viewbox: box, bounded: '1' }))
      if (!seen.has(`${r.osm_type}${r.osm_id}`) && nameMatches(name, r) && areaOf(region, r)) {
        seen.add(`${r.osm_type}${r.osm_id}`);
        const a = r.address || {};
        hits.push(`${r.name} [${r.category}=${r.type}] ${[a.house_number, a.road].filter(Boolean).join(' ') || '(no street)'}, ${areaOf(region, r)}`);
      }
  console.log(`${name}: ${hits.length ? hits.join(' | ') : 'NOT IN OSM'}`);
}
