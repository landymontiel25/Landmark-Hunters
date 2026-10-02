// Step 3: apply the import rules (category, facts, closed / unnamed /
// duplicate drops) to the pulled data.
//   node scripts/osm-import/stage.mjs
// Writes data/staged.json (places) and data/dropped.json (every drop + why).
import fs from 'node:fs';
import { ALL_LANDMARKS } from '../../src/data/regions.js';
import { importPlaces } from './transform.js';

const DIR = 'scripts/osm-import/data';
const { elements, osm3s } = JSON.parse(fs.readFileSync(`${DIR}/osm.json`, 'utf8'));
const wikidataFacts = fs.existsSync(`${DIR}/wikidata-facts.json`) ? JSON.parse(fs.readFileSync(`${DIR}/wikidata-facts.json`, 'utf8')) : {};
// Only the hand-curated catalog: places already imported must not count as
// duplicates of themselves.
const catalog = ALL_LANDMARKS.filter((l) => l.source !== 'osm');
const { places, dropped } = importPlaces(elements, { catalog, wikidataFacts });
fs.writeFileSync(`${DIR}/staged.json`, JSON.stringify(places, null, 1));
fs.writeFileSync(`${DIR}/dropped.json`, JSON.stringify({ osmBase: osm3s?.timestamp_osm_base, ...dropped }, null, 1));

const byCat = {};
for (const p of places) byCat[p.categories[0]] = (byCat[p.categories[0]] || 0) + 1;
console.log('staged by category:', byCat, 'total', places.length);
console.log('dropped:', Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, v.length])));
