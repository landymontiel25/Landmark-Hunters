// Merge thin-place research (out-NN.json here) into ../../web-facts.json and
// drop closed or unconfirmed places through ../../overrides.json.
//   node scripts/osm-import/research/thin/merge-thin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { okWebFact } from '../../transform.js';

const DIR = 'scripts/osm-import/research/thin';
const FACTS = 'scripts/osm-import/web-facts.json';
const OVERRIDES = 'scripts/osm-import/overrides.json';
const webFacts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
const GENERIC_START = /^(Serves |Offers |Has |Takes reservations|Takeout only|Wheelchair|Partly wheelchair|Address: )/;

const counts = { facts: 0, closed: 0, unconfirmed: 0, noFacts: 0, empty: [] };
for (const f of fs.readdirSync(DIR).filter((f) => /^out-\d+\.json$/.test(f)).sort()) {
  for (const r of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    if (r.closed) {
      overrides[r.id] = { ...overrides[r.id], drop: `closed for good per web research: ${r.name}`, source: r.closedSource };
      counts.closed++;
      continue;
    }
    const facts = (r.facts || []).map((x) => ({ text: x.text.trim(), url: x.url })).filter((x) => okWebFact(x) && x.text.length <= 120 && !GENERIC_START.test(x.text));
    if (facts.length) {
      webFacts[r.id] = { name: r.name, closed: false, closedSource: null, facts };
      counts.facts++;
    } else if (r.noFacts) {
      overrides[r.id] = { ...overrides[r.id], drop: 'no specific facts found online after 8 searches' };
      counts.noFacts++;
    } else if (r.notFound || !r.matched) {
      overrides[r.id] = { ...overrides[r.id], drop: 'not found online after 4 searches' };
      counts.unconfirmed++;
    } else counts.empty.push(`${f} ${r.id} ${r.name}`);
  }
}
fs.writeFileSync(FACTS, JSON.stringify(webFacts, null, 1) + '\n');
fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
console.log(`facts ${counts.facts}, closed ${counts.closed}, unconfirmed ${counts.unconfirmed}, no facts ${counts.noFacts}, matched but no usable fact ${counts.empty.length}`);
for (const e of counts.empty) console.log('  ' + e);
