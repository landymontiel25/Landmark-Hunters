// San Francisco / Silicon Valley import report: what shipped (by category,
// neighborhood or town, research tier) and every drop by reason, from the
// packs, located.json and the stage step's dropped.json.
//   node scripts/osm-import/research/summary.mjs   -> docs/sf-import/summary.json
import fs from 'node:fs';
import { PLACE_PACKS } from '../../../src/data/placePacks.manifest.js';

const out = {};
const count = (xs, f) => Object.fromEntries(Object.entries(Object.groupBy(xs, f)).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]));
for (const [r, region] of [['sf', 'san-francisco'], ['sv', 'silicon-valley']]) {
  const ps = PLACE_PACKS.filter((p) => p.region === region).flatMap((p) => JSON.parse(fs.readFileSync(`public/${p.file}`, 'utf8')));
  const staged = new Map(JSON.parse(fs.readFileSync(`scripts/osm-import/data/${r}/staged.json`, 'utf8')).map((p) => [p.id, p]));
  const located = JSON.parse(fs.readFileSync(`scripts/osm-import/research/${r}/located.json`, 'utf8'));
  const dropped = JSON.parse(fs.readFileSync(`scripts/osm-import/data/${r}/dropped.json`, 'utf8'));
  const tier = (p) => staged.get(p.id)?._tier || 'everyday';
  out[r] = {
    places: ps.length,
    byCategory: count(ps, (p) => p.categories[0]),
    byArea: count(ps, (p) => staged.get(p.id)?._area),
    byTier: count(ps, tier),
    insider: ps.filter((p) => tier(p) === 'insider').map((p) => ({ name: p.name, reason: staged.get(p.id)._reason })),
    acclaimed: ps.filter((p) => tier(p) === 'acclaimed').map((p) => p.name),
    withPhoto: ps.filter((p) => p.images.length).length,
    avgSourcedFacts: +(ps.reduce((a, p) => a + Object.keys(p.factSources || {}).length, 0) / ps.length).toFixed(2),
    avgFacts: +(ps.reduce((a, p) => a + p.facts.length, 0) / ps.length).toFixed(2),
    researched: located.length,
    located: count(located, (l) => l.status),
    stageDrops: {
      closedPerOsmTags: dropped.closed.length,
      osmKindNotListed: dropped.notListed.length,
      catalogDuplicate: dropped.duplicateOfCatalog.length,
      handReview: dropped.reviewed.length,
      ...count(dropped.notSelected, (x) => x.why),
    },
  };
}
fs.mkdirSync('docs/sf-import', { recursive: true });
fs.writeFileSync('docs/sf-import/summary.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
