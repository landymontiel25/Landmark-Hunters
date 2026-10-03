// Step 2: for every pulled place with a wikidata=Q... tag, read its Wikidata
// claims and render the fact lines (factsFromWikidata) into
// scripts/osm-import/data/<region>/wikidata-facts.json, keyed by Q-id.
//   node scripts/osm-import/fetch-wikidata.mjs [--region philly]   (default miami)
import fs from 'node:fs';
import { classify, factsFromWikidata } from './transform.js';
import { regionFromArgs } from './regions.js';

const region = regionFromArgs(process.argv);
const OSM = `${region.dataDir}/osm.json`;
const OUT = `${region.dataDir}/wikidata-facts.json`;
const API = 'https://www.wikidata.org/w/api.php';
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com; https://github.com/landymontiel25/Landmark-Hunters)';
const PROPS = ['P1619', 'P571', 'P84', 'P1083', 'P466', 'P138', 'P1435', 'P149', 'P170', 'P127', 'P137'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function entities(ids, props) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const q = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.slice(i, i + 50).join('|'), props, languages: 'en' });
    let r;
    for (let attempt = 1; ; attempt++) {
      r = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } });
      if ((r.status !== 429 && r.status < 500) || attempt === 6) break;
      await sleep(Number(r.headers.get('retry-after')) * 1000 || 5000 * attempt);
    }
    if (!r.ok) throw new Error(`Wikidata ${r.status}`);
    Object.assign(out, (await r.json()).entities || {});
    await sleep(200);
  }
  return out;
}

const { elements } = JSON.parse(fs.readFileSync(OSM, 'utf8'));
const byQ = new Map();
for (const el of elements) {
  const q = el.tags?.wikidata;
  if (/^Q\d+$/.test(q || '') && classify(el.tags)) byQ.set(q, classify(el.tags).category);
}
const main = await entities([...byQ.keys()], 'claims');
const refs = new Set();
for (const e of Object.values(main))
  for (const p of PROPS) for (const c of e.claims?.[p] || []) if (c.mainsnak?.datavalue?.value?.id) refs.add(c.mainsnak.datavalue.value.id);
const labelled = await entities([...refs], 'labels');
const labels = Object.fromEntries(Object.entries(labelled).map(([id, e]) => [id, e.labels?.en?.value]).filter(([, v]) => v));
const facts = {};
for (const [q, category] of byQ) {
  const f = factsFromWikidata(main[q], labels, category);
  if (f.length) facts[q] = f;
}
fs.writeFileSync(OUT, JSON.stringify(facts, null, 1));
console.log(`${byQ.size} Wikidata items, ${Object.keys(facts).length} with facts -> ${OUT}`);
