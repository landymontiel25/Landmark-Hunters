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
// The generic lines select-thin.mjs looks for (a web fact must add more than these).
const GENERIC =
  /^(Address: |Serves |Offers takeout|Offers delivery|Takeout only|Has outdoor seating|Has Wi-Fi|Wheelchair accessible|Partly wheelchair|Has a bar|Part of the .* chain|Has vegan|Has vegetarian|Takes reservations|Open 24 hours|Has high chairs|Has restrooms|Accepts Bitcoin|Dogs allowed|No dogs)/;

// A later out-NN.json (e.g. a retry batch) replaces an earlier result for the same place.
const results = new Map();
for (const f of fs.readdirSync(DIR).filter((f) => /^out-\d+\.json$/.test(f)).sort())
  for (const r of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) results.set(r.id, { ...r, file: f });

const counts = { facts: 0, closed: 0, unconfirmed: 0, noFacts: 0, empty: [] };
for (const r of results.values()) {
  if (r.closed) {
    overrides[r.id] = { ...overrides[r.id], drop: `closed for good per web research: ${r.name}`, source: r.closedSource };
    counts.closed++;
    continue;
  }
  const facts = (r.facts || []).map((x) => ({ text: x.text.trim(), url: x.url.replace(/^http:\/\//, 'https://').replaceAll("'", '%27') })).filter((x) => okWebFact(x) && x.text.length <= 120 && !GENERIC.test(x.text));
  if (facts.length) {
    webFacts[r.id] = { name: r.name, closed: false, closedSource: null, facts };
    counts.facts++;
  } else if (r.noFacts) {
    overrides[r.id] = { ...overrides[r.id], drop: 'no specific facts found online after 8 searches' };
    counts.noFacts++;
  } else if (r.notFound || !r.matched) {
    overrides[r.id] = { ...overrides[r.id], drop: 'not found online after 4 searches' };
    counts.unconfirmed++;
  } else counts.empty.push(`${r.file} ${r.id} ${r.name}`);
  }
fs.writeFileSync(FACTS, JSON.stringify(webFacts, null, 1) + '\n');
fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
console.log(`facts ${counts.facts}, closed ${counts.closed}, unconfirmed ${counts.unconfirmed}, no facts ${counts.noFacts}, matched but no usable fact ${counts.empty.length}`);
for (const e of counts.empty) console.log('  ' + e);
