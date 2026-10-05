// Second pass for San Francisco / Silicon Valley (VERIFY-PROMPT.md): picks
// a seeded random 20% of the located places, plus every place with an
// award fact (those go stale), and writes them as
// research/<region>/verify-NN.json, 20 places each.
//   node scripts/osm-import/research/build-verify.mjs sf
import fs from 'node:fs';

const region = process.argv[2];
const DIR = `scripts/osm-import/research/${region}`;
const PER_BATCH = 20;
const AWARD = /michelin|bib gourmand|james beard|top 100|50 best|award|named (one|to)/i;
const located = JSON.parse(fs.readFileSync(`${DIR}/located.json`, 'utf8')).filter((l) => l.status === 'FOUND');
const webFacts = JSON.parse(fs.readFileSync('scripts/osm-import/web-facts.json', 'utf8'));
let seed = 20261005;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffled = [...located].sort((a, b) => a.id.localeCompare(b.id)).map((l) => [rand(), l]).sort((a, b) => a[0] - b[0]).map(([, l]) => l);
const sample = new Set(shuffled.slice(0, Math.ceil(located.length * 0.2)).map((l) => l.id));
for (const l of located) if ((webFacts[l.id]?.facts || []).some((f) => AWARD.test(f.text))) sample.add(l.id);
const rows = located
  .filter((l) => sample.has(l.id))
  .map((l) => ({ id: l.id, name: l.name, address: l.address, city: region === 'sf' ? 'San Francisco' : l.town, facts: webFacts[l.id].facts }));
for (const f of fs.readdirSync(DIR).filter((f) => /^verify-\d+\.json$/.test(f))) fs.unlinkSync(`${DIR}/${f}`);
for (let i = 0; i < rows.length; i += PER_BATCH) fs.writeFileSync(`${DIR}/verify-${String(i / PER_BATCH).padStart(2, '0')}.json`, JSON.stringify(rows.slice(i, i + PER_BATCH), null, 1));
console.log(`${located.length} located; verifying ${rows.length} (${Math.ceil(located.length * 0.2)} random + award facts) in ${Math.ceil(rows.length / PER_BATCH)} batches`);
