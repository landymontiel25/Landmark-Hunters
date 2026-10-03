// Second research pass: imported places whose facts are all generic (none,
// or only address / amenity / chain lines). Writes batch-NN.json (25 places
// each) next to this file in the same shape as ../batch-NN.json.
//   node scripts/osm-import/research/thin/select-thin.mjs
import fs from 'node:fs';
import path from 'node:path';

const REGIONS = ['miami', 'philly', 'villanova'];
const BATCH = 25;
const OUT = 'scripts/osm-import/research/thin';
const GENERIC =
  /^(Address: |Serves |Offers takeout|Offers delivery|Takeout only|Has outdoor seating|Has Wi-Fi|Wheelchair accessible|Partly wheelchair|Has a bar|Part of the .* chain|Has vegan|Has vegetarian|Takes reservations|Open 24 hours|Has high chairs|Has restrooms|Accepts Bitcoin|Dogs allowed|No dogs)/;

export const isThin = (p) => p.facts.every((f) => GENERIC.test(f));

const thin = [];
for (const region of REGIONS) {
  const dir = path.join('public/places', region);
  for (const f of fs.readdirSync(dir).sort()) {
    for (const p of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (!isThin(p)) continue;
      const address = p.facts.find((x) => x.startsWith('Address: '))?.slice(9) || null;
      thin.push({
        id: p.id,
        name: p.name,
        region,
        category: p.categories[0],
        kind: p.topic,
        summary: p.summary,
        address,
        lat: p.lat,
        lng: p.lng,
        website: p.website || null,
        knownFacts: p.facts,
      });
    }
  }
}
for (const f of fs.readdirSync(OUT)) if (/^batch-\d+\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
for (let i = 0; i < thin.length; i += BATCH) {
  const n = String(i / BATCH).padStart(2, '0');
  fs.writeFileSync(path.join(OUT, `batch-${n}.json`), '[' + thin.slice(i, i + BATCH).map((p) => JSON.stringify(p)).join(',\n') + ']\n');
}
const by = Object.fromEntries(REGIONS.map((r) => [r, thin.filter((p) => p.region === r).length]));
console.log(`${thin.length} thin places (${JSON.stringify(by)}) in ${Math.ceil(thin.length / BATCH)} batches`);
