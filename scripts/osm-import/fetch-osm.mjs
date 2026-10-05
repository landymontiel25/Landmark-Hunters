// Step 1 of the OSM import: pull every listed place inside the region's shape
// (regions.js) from the free Overpass API into
// scripts/osm-import/data/<region>/osm.json.
//   node scripts/osm-import/fetch-osm.mjs [--region philly]   (default miami)
// Needs network access to overpass-api.de. No key, no cost.
import fs from 'node:fs';
import { overpassQuery } from './transform.js';
import { regionFromArgs } from './regions.js';

const region = regionFromArgs(process.argv);
const OUT = `${region.dataDir}/osm.json`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com)';

fs.mkdirSync(region.dataDir, { recursive: true });
// Places added by hand (overrides.json `include`) come along by id.
const LETTER_TYPE = { n: 'node', w: 'way', r: 'relation' };
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
const extra = Object.entries(overrides)
  .filter(([id, o]) => o?.include && o.include.region === region.id && /^osm-[nwr]\d+$/.test(id))
  .map(([id]) => `${LETTER_TYPE[id[4]]}/${id.slice(5)}`);
const query = overpassQuery(region.shape, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Overpass allows two queries at a time per client and answers 429 (an HTML
// page) when both are busy; some networks also drop connections now and then.
// Retry with backoff before giving up.
let lastError;
for (let attempt = 1; attempt <= 30; attempt++) {
  const url = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240000) });
    if (r.status === 429 || r.status === 504) throw new Error(`${url} busy (${r.status})`);
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    const data = await r.json();
    if (data.remark && /runtime error|timed out/i.test(data.remark)) throw new Error(`overpass: ${data.remark}`);
    fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), osm3s: data.osm3s, elements: data.elements }));
    console.log(`${data.elements.length} elements -> ${OUT} (OSM data as of ${data.osm3s?.timestamp_osm_base})`);
    process.exit(0);
  } catch (e) {
    lastError = e;
    console.warn(`attempt ${attempt}: ${e.cause?.code || ''} ${e.message}`);
    await sleep(Math.min(60000, 5000 * attempt));
  }
}
throw lastError;
