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
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com)';

fs.mkdirSync(region.dataDir, { recursive: true });
// Places added by hand (overrides.json `include`) come along by id.
const LETTER_TYPE = { n: 'node', w: 'way', r: 'relation' };
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
const extra = Object.entries(overrides)
  .filter(([id, o]) => o?.include && o.include.region === region.id && /^osm-[nwr]\d+$/.test(id))
  .map(([id]) => `${LETTER_TYPE[id[4]]}/${id.slice(5)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Overpass allows two queries at a time per client and answers 429 (an HTML
// page) when both are busy; some networks also drop connections now and then.
// Retry with backoff before giving up.
async function overpass(query) {
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

if (!region.parts) {
  const data = await overpass(overpassQuery(region.shape, extra));
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), osm3s: data.osm3s, elements: data.elements }));
  console.log(`${data.elements.length} elements -> ${OUT} (OSM data as of ${data.osm3s?.timestamp_osm_base})`);
} else {
  // One pull per part (a town's boundary or a drawn shape); each element
  // keeps the part it came from as `town`. Hand-added places name their
  // town in overrides.json (include.town).
  const byId = new Map();
  let osm3s;
  for (const part of region.parts) {
    const data = await overpass(part.town ? overpassQuery(region.shape, [], { town: part.town }) : overpassQuery(part.shape));
    osm3s = data.osm3s;
    for (const el of data.elements) if (!byId.has(`${el.type}/${el.id}`)) byId.set(`${el.type}/${el.id}`, { ...el, town: part.name });
    console.log(`${part.name}: ${data.elements.length} elements`);
  }
  if (extra.length) {
    const data = await overpass(overpassQuery([[0, 0], [0, 0], [0, 0]], extra).replace(/^ {2}nwr.*\n/gm, ''));
    for (const el of data.elements) {
      const town = overrides[`osm-${el.type[0]}${el.id}`]?.include?.town;
      if (town && region.parts.some((p) => p.name === town)) byId.set(`${el.type}/${el.id}`, { ...el, town });
      else console.warn(`hand-added ${el.type}/${el.id} has no town from regions.js parts; left out`);
    }
  }
  const elements = [...byId.values()];
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), osm3s, elements }));
  console.log(`${elements.length} elements -> ${OUT} (OSM data as of ${osm3s?.timestamp_osm_base})`);
}
