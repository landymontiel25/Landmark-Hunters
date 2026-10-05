// San Francisco web research, step 2: merge out-NN.json here into
// ../../web-facts.json and drop closed or unconfirmed places through
// ../../overrides.json. Facts the second verification pass could not confirm
// (verify-NN.json, verdict "fail") stay out.
//   node scripts/osm-import/research/sf/merge-sf.mjs
import fs from 'node:fs';
import path from 'node:path';
import { okWebFact } from '../../transform.js';

const DIR = 'scripts/osm-import/research/sf';
const FACTS = 'scripts/osm-import/web-facts.json';
const OVERRIDES = 'scripts/osm-import/overrides.json';
const webFacts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
// The generic lines select-thin.mjs looks for (a web fact must add more than these).
const GENERIC =
  /^(Address: |Serves |Offers takeout|Offers delivery|Takeout only|Has outdoor seating|Has Wi-Fi|Wheelchair accessible|Partly wheelchair|Has a bar|Part of the .* chain|Has vegan|Has vegetarian|Takes reservations|Open 24 hours|Has high chairs|Has restrooms|Accepts Bitcoin|Dogs allowed|No dogs)/;
// Wording the research rules forbid, caught again here.
const OPINION = /\b(known for|renowned|legendary|hidden gem|cozy|amazing|beloved|popular|favorite|must[- ]try|stunning|delicious|world[- ]class|award-winning)\b/i;

const files = (re) => fs.readdirSync(DIR).filter((f) => re.test(f)).sort();
// A later out-NN.json (e.g. a retry batch) replaces an earlier result for the same place.
const results = new Map();
for (const f of files(/^out-\d+\.json$/)) for (const r of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) results.set(r.id, { ...r, file: f });
const failed = new Set();
for (const f of files(/^verify-\d+\.json$/))
  for (const v of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) if (v.verdict === 'fail') failed.add(`${v.id}\n${v.text}`);

const counts = { facts: 0, factLines: 0, closed: 0, unconfirmed: 0, verifyRemoved: 0, empty: [] };
for (const r of results.values()) {
  if (r.closed) {
    overrides[r.id] = { ...overrides[r.id], drop: `closed for good per web research: ${r.name}`, source: r.closedSource };
    counts.closed++;
    continue;
  }
  if (r.notFound || !r.matched) {
    overrides[r.id] = { ...overrides[r.id], drop: 'not found online after 4 searches' };
    counts.unconfirmed++;
    continue;
  }
  const facts = (r.facts || [])
    .map((x) => ({ text: x.text.trim(), url: x.url.replace(/^http:\/\//, 'https://').replaceAll("'", '%27') }))
    .filter((x) => okWebFact(x) && x.text.length <= 120 && !GENERIC.test(x.text) && !OPINION.test(x.text))
    .filter((x) => {
      const ok = !failed.has(`${r.id}\n${x.text}`);
      if (!ok) counts.verifyRemoved++;
      return ok;
    });
  if (facts.length) {
    webFacts[r.id] = { name: r.name, closed: false, closedSource: null, facts };
    counts.facts++;
    counts.factLines += facts.length;
  } else {
    delete webFacts[r.id];
    counts.empty.push(`${r.file} ${r.id} ${r.name}`);
  }
}
fs.writeFileSync(FACTS, JSON.stringify(webFacts, null, 1) + '\n');
fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
console.log(
  `places with facts ${counts.facts} (${counts.factLines} facts), closed ${counts.closed}, not found ${counts.unconfirmed}, facts removed by verification ${counts.verifyRemoved}, matched but no usable fact ${counts.empty.length}`
);
for (const e of counts.empty) console.log('  ' + e);
