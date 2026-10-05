// Step 1 for research-first regions (San Francisco, Silicon Valley), in
// place of fetch-osm.mjs: finds every researched candidate
// (research/<region>/out-*.json, RESEARCH-PROMPT.md) in OpenStreetMap through
// Nominatim and writes the matches as data/<region>/osm.json, the same
// element list fetch-osm.mjs writes, so stage.mjs and the rest run unchanged.
//   node scripts/osm-import/locate-candidates.mjs --region sf
// A match needs the OSM name AND the researched address (locate.js
// pickMatch); everything else is NOT_FOUND and stays out. Also writes
// research/<region>/located.json (every candidate, found or why not) and
// puts each found place's researched facts into web-facts.json by its id.
// Nominatim's usage policy: at most one request a second, a User-Agent
// naming the app, and every reply cached (data/<region>/nominatim/) so a
// rerun doesn't ask again.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { regionFromArgs } from './regions.js';
import { pickMatch, areaOf, viewbox, elementOf, parseAddress, OPINION, core } from './locate.js';
import { normName } from '../../src/lib/placeMatch.js';
import { okWebFact } from './transform.js';

const region = regionFromArgs(process.argv);
const RESEARCH = `scripts/osm-import/research/${region.id}`;
const CACHE = `${region.dataDir}/nominatim`;
const FACTS = 'scripts/osm-import/web-facts.json';
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com; https://github.com/landymontiel25/Landmark-Hunters)';
const API = 'https://nominatim.openstreetmap.org/search';
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0;
async function nominatim(params) {
  const q = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', extratags: '1', namedetails: '1', limit: '10', countrycodes: 'us', ...params });
  const file = `${CACHE}/${crypto.createHash('sha1').update(q.toString()).digest('hex')}.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, last + 1100 - Date.now()));
    last = Date.now();
    try {
      const r = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`Nominatim ${r.status}`);
      const data = await r.json();
      fs.writeFileSync(file, JSON.stringify(data));
      return data;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.warn(`retry ${attempt}: ${e.message}`);
      await sleep(5000 * attempt);
    }
  }
}

// The researched address, geocoded (structured search), or null.
async function geocode(c) {
  const { number, street } = parseAddress(c.address);
  if (!street) return null;
  const city = c.city || (region.id === 'sf' ? 'San Francisco' : null);
  if (!city) return null;
  const hits = await nominatim({ street: number ? `${number} ${street}` : street, city, state: 'California', limit: '1', extratags: '0', namedetails: '0' });
  // A street-only hit (no house number) is a whole street, not an address.
  const h = hits[0];
  if (!h || (number && !h.address?.house_number)) return null;
  return { lat: Number(h.lat), lng: Number(h.lon) };
}

const key = (s) => normName(s).replace(/^the /, '');
const rows = new Map();
for (const f of fs.readdirSync(RESEARCH).filter((f) => /^out-.*\.json$/.test(f)).sort())
  for (const r of JSON.parse(fs.readFileSync(`${RESEARCH}/${f}`, 'utf8'))) if (r?.name) rows.set(key(r.name), { ...r, file: f });

const box = viewbox(region.shape);
const located = [];
const elements = new Map();
const webFacts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
for (const c of rows.values()) {
  const base = { name: c.name, file: c.file, area: c.area || null, address: c.address || null, tier: c.tier || 'everyday' };
  if (c.closed) { located.push({ ...base, status: 'CLOSED', why: c.closedSource || 'closed per research' }); continue; }
  if (c.notFound || c.matched === false) { located.push({ ...base, status: 'UNCONFIRMED', why: 'research found no result confirming it' }); continue; }
  const facts = (c.facts || []).filter((x) => okWebFact(x) && x.text.length <= 120 && !OPINION.test(x.text));
  if (!facts.length) { located.push({ ...base, status: 'NO_FACTS', why: 'no sourced fact passed the fact rules' }); continue; }
  let results = await nominatim({ q: c.name, viewbox: box, bounded: '1' });
  let geo = null;
  let match = pickMatch(c, results, { inArea: (r) => !!areaOf(region, r) });
  if (match.status !== 'FOUND') {
    // The name alone can miss (Nominatim ranks other things higher): add the street.
    // Or OSM leaves out a kind word ("Roxie Theater" is mapped as "Roxie").
    const { street } = parseAddress(c.address);
    const queries = [street && `${c.name}, ${street}`, core(c.name) !== normName(c.name) && core(c.name).length >= 4 && core(c.name)].filter(Boolean);
    for (const q of queries) {
      const more = await nominatim({ q, viewbox: box, bounded: '1' });
      results = [...results, ...more.filter((m) => !results.some((r) => r.osm_id === m.osm_id && r.osm_type === m.osm_type))];
    }
    geo = await geocode(c);
    match = pickMatch(c, results, { geo, inArea: (r) => !!areaOf(region, r) });
  }
  if (match.status !== 'FOUND') { located.push({ ...base, status: 'NOT_FOUND', why: match.why }); continue; }
  const r = match.result;
  // A region pulled part by part keeps the town as the element's part;
  // San Francisco finds each place's neighborhood from its position (stage.mjs).
  const town = areaOf(region, r);
  const city = region.id === 'sf' ? 'San Francisco' : r.address?.city || r.address?.town || null;
  const el = elementOf(r, { candidate: c, town: region.parts ? town : undefined, city });
  const id = `osm-${el.type[0]}${el.id}`;
  if (elements.has(id)) { located.push({ ...base, status: 'DUPLICATE', why: `same OSM object as ${elements.get(id).research.name}`, id }); continue; }
  el.research = { name: c.name, tier: base.tier, reason: c.reason?.text && c.reason?.url ? c.reason : null };
  elements.set(id, el);
  webFacts[id] = { name: c.name, closed: false, closedSource: null, facts: facts.map((x) => ({ text: x.text.trim(), url: x.url })) };
  located.push({ ...base, status: 'FOUND', id, how: match.how, town, lat: el.lat, lng: el.lon, osmName: el.tags.name });
}

fs.writeFileSync(`${region.dataDir}/osm.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), osm3s: { timestamp_osm_base: 'nominatim' }, elements: [...elements.values()] }));
fs.writeFileSync(`${RESEARCH}/located.json`, JSON.stringify(located, null, 1) + '\n');
fs.writeFileSync(FACTS, JSON.stringify(webFacts, null, 1) + '\n');
const counts = {};
for (const l of located) counts[l.status] = (counts[l.status] || 0) + 1;
console.log(`${rows.size} candidates:`, counts);
