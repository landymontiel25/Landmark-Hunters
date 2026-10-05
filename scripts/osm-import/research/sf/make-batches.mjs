// San Francisco web research, step 1: every staged SF place as
// batch-NN.json here (25 places each), landmarks first and food last, in the
// shape PROMPT.md describes. Ids in done.json (already researched) are left out.
//   node scripts/osm-import/research/sf/make-batches.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SF_NEIGHBORHOODS } from '../../regions.js';
import { nearestNeighborhood } from '../../select.js';

const DIR = 'scripts/osm-import/research/sf';
const BATCH = 25;
const ORDER = ['stadiums', 'art-museums', 'history-culture', 'entertainment', 'parks-nature', 'sports', 'local-life', 'food'];
const staged = JSON.parse(fs.readFileSync('scripts/osm-import/data/san-francisco/staged.json', 'utf8'));
const done = new Set(fs.existsSync(`${DIR}/done.json`) ? JSON.parse(fs.readFileSync(`${DIR}/done.json`, 'utf8')) : []);
const rank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
const places = staged
  .filter((p) => !done.has(p.id))
  .sort((a, b) => rank(a.categories[0]) - rank(b.categories[0]) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  .map((p) => ({
    id: p.id,
    name: p.name,
    category: p.categories[0],
    kind: p.topic,
    summary: p.summary,
    address: p.facts.find((f) => f.startsWith('Address: '))?.slice(9) || null,
    neighborhood: nearestNeighborhood(p, SF_NEIGHBORHOODS),
    lat: p.lat,
    lng: p.lng,
    website: p.website || null,
    knownFacts: p.facts.filter((f) => !f.startsWith('Address: ')),
  }));
for (const f of fs.readdirSync(DIR)) if (/^batch-\d+\.json$/.test(f)) fs.unlinkSync(path.join(DIR, f));
for (let i = 0; i < places.length; i += BATCH) {
  const n = String(i / BATCH).padStart(2, '0');
  fs.writeFileSync(path.join(DIR, `batch-${n}.json`), '[' + places.slice(i, i + BATCH).map((p) => JSON.stringify(p)).join(',\n') + ']\n');
}
console.log(`${places.length} places in ${Math.ceil(places.length / BATCH)} batches`);
