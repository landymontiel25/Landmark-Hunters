// Apply a hand review (review-N.json here: drops by reason, category/topic
// fixes) to ../../overrides.json, resolving each name to its staged id.
//   node scripts/osm-import/research/sf/apply-review.mjs review-1.json
import fs from 'node:fs';

const OVERRIDES = 'scripts/osm-import/overrides.json';
const review = JSON.parse(fs.readFileSync(`scripts/osm-import/research/sf/${process.argv[2]}`, 'utf8'));
const staged = JSON.parse(fs.readFileSync('scripts/osm-import/data/san-francisco/staged.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
const idOf = (name, id) => {
  const m = staged.filter((p) => p.name === name && (!id || p.id === id));
  if (m.length !== 1) throw new Error(`${name}: ${m.length} staged matches`);
  return m[0].id;
};
for (const [name, why, id] of review.drop || []) overrides[idOf(name, id)] = { ...overrides[idOf(name, id)], drop: why };
for (const [name, fix, id] of review.fix || []) overrides[idOf(name, id)] = { ...overrides[idOf(name, id)], ...fix };
fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
console.log(`${(review.drop || []).length} drops, ${(review.fix || []).length} fixes -> ${OVERRIDES}`);
