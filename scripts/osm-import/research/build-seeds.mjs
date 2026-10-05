// San Francisco / Silicon Valley: merges the candidate lists
// (research/<region>/lists/*.json, from LISTS-PROMPT.md) into named seeds,
// one per place, and writes them as research batches
// (research/<region>/seed-NN.json) for RESEARCH-PROMPT.md.
//   node scripts/osm-import/research/build-seeds.mjs sf
// A list row is only a lead: the research pass confirms the place and
// sources every fact, award or tech link it keeps.
import fs from 'node:fs';
import { normName } from '../../../src/lib/placeMatch.js';

const region = process.argv[2];
const DIR = `scripts/osm-import/research/${region}`;
const PER_BATCH = 35;
const key = (s) => normName(s).replace(/^the /, '');
const catalog = new Set(JSON.parse(fs.readFileSync(`${DIR}/catalog-names.json`, 'utf8')).map(key));
const seeds = new Map();
for (const f of fs.readdirSync(`${DIR}/lists`).sort()) {
  for (const r of JSON.parse(fs.readFileSync(`${DIR}/lists/${f}`, 'utf8'))) {
    const k = key(r.name);
    if (!k || catalog.has(k)) continue;
    if (!seeds.has(k)) seeds.set(k, { name: r.name, area: null, address: null, leads: [] });
    const s = seeds.get(k);
    s.area ||= r.area || null;
    s.address ||= r.address || null;
    s.leads.push({ list: r.list, year: r.year ?? null, url: r.sourceUrl, ...(r.note ? { note: r.note } : {}) });
  }
}
// Batches already written keep their places; new seeds go into new batches.
const done = new Set();
for (const f of fs.readdirSync(DIR).filter((f) => /^seed-\d+\.json$/.test(f))) for (const s of JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'))) done.add(key(s.name));
const fresh = [...seeds.values()].filter((s) => !done.has(key(s.name)));
let n = fs.readdirSync(DIR).filter((f) => /^seed-\d+\.json$/.test(f)).length;
for (let i = 0; i < fresh.length; i += PER_BATCH) {
  const file = `${DIR}/seed-${String(n++).padStart(2, '0')}.json`;
  fs.writeFileSync(file, JSON.stringify(fresh.slice(i, i + PER_BATCH), null, 1));
  console.log(`${file}: ${Math.min(PER_BATCH, fresh.length - i)} seeds`);
}
console.log(`${seeds.size} seeds, ${fresh.length} new`);
