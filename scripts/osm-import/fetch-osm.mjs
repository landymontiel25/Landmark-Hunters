// Step 1 of the OSM import: pull every listed place inside the region's shape
// (regions.js) from the free Overpass API into
// scripts/osm-import/data/<region>/osm.json.
//   node scripts/osm-import/fetch-osm.mjs [--region philly] [--split]   (default miami)
// --split asks for each kind of place in its own query (overpassQueryParts)
// and merges the answers, for when a mirror times out on the whole pull.
// --areas instead pulls the outlines of parks, gardens, beaches and zoos
// into data/<region>/areas.json ({id: {acres, rings}}), which select.js
// uses to measure parks and to find places inside another one.
// Needs network access to overpass-api.de. No key, no cost.
import fs from 'node:fs';
import { overpassAreasQuery, overpassQuery, overpassQueryParts, outerRings, ringAcres } from './transform.js';
import { regionFromArgs } from './regions.js';

const region = regionFromArgs(process.argv);
const split = process.argv.includes('--split');
const areas = process.argv.includes('--areas');
const OUT = `${region.dataDir}/osm.json`;
// The first mirror that answers wins; overpass-api.de and kumi.systems were
// refusing or timing out from the cloud environment in October 2026.
const ENDPOINTS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com)';

fs.mkdirSync(region.dataDir, { recursive: true });
// Places added by hand (overrides.json `include`) come along by id.
const LETTER_TYPE = { n: 'node', w: 'way', r: 'relation' };
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
const extra = Object.entries(overrides)
  .filter(([id, o]) => o?.include && o.include.region === region.id && /^osm-[nwr]\d+$/.test(id))
  .map(([id]) => `${LETTER_TYPE[id[4]]}/${id.slice(5)}`);
const queries = split ? overpassQueryParts(region.shape, extra) : [overpassQuery(region.shape, extra)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Overpass allows two queries at a time per client and answers 429 (an HTML
// page) when both are busy; some networks also drop connections now and then.
// Retry with backoff before giving up.
async function run(query) {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt++) {
    const url = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240000) });
      if (r.status === 429 || r.status === 504) throw new Error(`${url} busy (${r.status})`);
      if (!r.ok) throw new Error(`${url} answered ${r.status}`);
      const data = await r.json();
      if (data.remark && /runtime error|timed out/i.test(data.remark)) throw new Error(`overpass: ${data.remark}`);
      return data;
    } catch (e) {
      lastError = e;
      console.warn(`attempt ${attempt}: ${e.cause?.code || ''} ${e.message}`);
      await sleep(Math.min(60000, 5000 * attempt));
    }
  }
  throw lastError;
}
if (areas) {
  const data = await run(overpassAreasQuery(region.shape));
  const out = {};
  const round = (r) => r.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
  for (const el of data.elements) {
    const rings = outerRings(el);
    if (rings.length) out[`osm-${el.type[0]}${el.id}`] = { acres: Math.round(rings.reduce((s, r) => s + ringAcres(r), 0) * 100) / 100, rings: rings.map(round) };
  }
  fs.writeFileSync(`${region.dataDir}/areas.json`, JSON.stringify(out));
  console.log(`${Object.keys(out).length} outlines -> ${region.dataDir}/areas.json`);
  process.exit(0);
}
const elements = new Map();
let osm3s;
for (const [i, query] of queries.entries()) {
  const data = await run(query);
  osm3s ??= data.osm3s;
  for (const el of data.elements) elements.set(`${el.type}/${el.id}`, el);
  if (split) console.log(`part ${i + 1}/${queries.length}: ${data.elements.length} elements`);
}
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), osm3s, elements: [...elements.values()] }));
console.log(`${elements.size} elements -> ${OUT} (OSM data as of ${osm3s?.timestamp_osm_base})`);
