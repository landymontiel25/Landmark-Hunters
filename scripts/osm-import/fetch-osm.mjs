// Step 1 of the OSM import: pull every listed place inside the Miami shape
// from the free Overpass API into scripts/osm-import/data/osm.json.
//   node scripts/osm-import/fetch-osm.mjs
// Needs network access to overpass-api.de. No key, no cost.
import fs from 'node:fs';
import { overpassQuery } from './transform.js';

const OUT = 'scripts/osm-import/data/osm.json';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com)';

fs.mkdirSync('scripts/osm-import/data', { recursive: true });
const query = overpassQuery();
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
