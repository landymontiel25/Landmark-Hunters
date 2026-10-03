// Step 5 (after find-commons-photos.mjs --places): write one category's
// places as chunk files in public/places/<region>/ and list them in
// src/data/placePacks.manifest.js.
//   node scripts/osm-import/build-packs.mjs <category>
// Prints the batch report and writes docs/miami-import/<category>.json (the
// report data) for plot.py.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ALL_LANDMARKS } from '../../src/data/regions.js';
import { PLACE_PACKS } from '../../src/data/placePacks.manifest.js';
import { withWebFacts } from './transform.js';

const category = process.argv[2];
if (!category) throw new Error('usage: build-packs.mjs <category>');
const REGION = 'miami';
const DIR = 'scripts/osm-import/data';
const CHUNK = 1500;
const LICENSE_OK = /^(public domain|cc0|cc[ -]by(?:[ -]sa)?\b|pd\b)/i;

// Photos rejected after looking at them (overrides.json rejectPhoto), and
// places dropped by hand (drop), e.g. closed for good per web research.
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
// data/ is gitignored, so a fresh checkout has no staged.json. Without it the
// current packs stand in for it: web facts come back off (they are re-applied
// below from web-facts.json) and each place keeps the photo it already has.
const fromPacks = !fs.existsSync(`${DIR}/staged.json`);
if (fromPacks) console.log(`no ${DIR}/staged.json: rebuilding from the current packs (photos kept as they are)`);
const keptCredits = new Map();
const allStaged = fromPacks
  ? PLACE_PACKS.filter((pack) => pack.region === REGION).flatMap((pack) =>
      JSON.parse(fs.readFileSync(path.join('public', pack.file), 'utf8')).map(({ factSources, imageCredits, ...p }) => {
        if (imageCredits) keptCredits.set(p.id, imageCredits);
        return { ...p, facts: p.facts.filter((f) => !factSources?.[f]) };
      })
    )
  : JSON.parse(fs.readFileSync(`${DIR}/staged.json`, 'utf8'));
const staged = allStaged.filter((p) => p.categories[0] === category && !overrides[p.id]?.drop);
if (!staged.length) throw new Error(`no staged places in ${category}`);
const found = fs.existsSync(`${DIR}/commons.found.json`) ? JSON.parse(fs.readFileSync(`${DIR}/commons.found.json`, 'utf8')) : [];
const photoOf = new Map(found.filter((r) => r.status === 'found').map((r) => [r.id, r]));
const sameName = new Map();
for (const p of allStaged) sameName.set(p.name, (sameName.get(p.name) || 0) + 1);
// Facts found by web research (scripts/osm-import/web-facts.json), each with
// the page that states it (transform.js withWebFacts).
const webFacts = fs.existsSync('scripts/osm-import/web-facts.json') ? JSON.parse(fs.readFileSync('scripts/osm-import/web-facts.json', 'utf8')) : {};

// A Commons file is used by one place only, across the catalog and every pack.
const otherPackFiles = PLACE_PACKS.filter((p) => p.category !== category).map((p) => p.file);
const used = new Set(ALL_LANDMARKS.flatMap((l) => l.images || []));
for (const f of otherPackFiles) for (const p of JSON.parse(fs.readFileSync(path.join('public', f), 'utf8'))) for (const u of p.images) used.add(u);

const photoSkips = [];
const places = staged.map((p) => withWebFacts(p, webFacts)).map((p) => {
  const r = photoOf.get(p.id);
  if (!r) return keptCredits.has(p.id) ? { ...p, imageCredits: keptCredits.get(p.id) } : p;
  const skip = (why) => (photoSkips.push({ id: p.id, name: p.name, why }), p);
  if (overrides[p.id]?.rejectPhoto) return skip(`reviewed: ${overrides[p.id].rejectPhoto}`);
  // Chains: a file named "Chicken Kitchen" fits every branch, so only a
  // photo geotagged at this branch counts.
  if (sameName.get(p.name) > 1 && !/within 150 m/.test(r.why || '')) return skip('several places share this name and the photo is not geotagged at this one');
  if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^\s"'\\]+\.(jpe?g|png)\?width=1200$/i.test(r.imageUrl || '')) return skip('bad imageUrl');
  if (!LICENSE_OK.test(String(r.license || '').trim()) || /\b(nc|nd)\b/i.test(r.license)) return skip(`license ${r.license}`);
  if (!/^(public domain|cc0|pd)/i.test(r.license) && !r.author) return skip('license needs an author');
  if (used.has(r.imageUrl)) return skip('file already used by another place');
  used.add(r.imageUrl);
  return {
    ...p,
    images: [r.imageUrl],
    imageCredits: { [r.imageUrl]: { author: r.author, license: r.license, licenseUrl: r.licenseUrl, pageUrl: r.pageUrl } },
  };
});

// Old chunks for this category go; new ones get a content hash in the name.
const outDir = path.join('public', 'places', REGION);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${category}.`) || f.startsWith(`${category}-`)) fs.unlinkSync(path.join(outDir, f));
const entries = [];
for (let i = 0; i < places.length; i += CHUNK) {
  const body = JSON.stringify(places.slice(i, i + CHUNK));
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
  const name = `${category}${places.length > CHUNK ? `-${i / CHUNK + 1}` : ''}.${hash}.json`;
  fs.writeFileSync(path.join(outDir, name), body);
  entries.push({ region: REGION, category, file: `places/${REGION}/${name}`, count: Math.min(CHUNK, places.length - i) });
}
const packs = [...PLACE_PACKS.filter((p) => p.category !== category || p.region !== REGION), ...entries];
fs.writeFileSync(
  'src/data/placePacks.manifest.js',
  `// Generated by scripts/osm-import/build-packs.mjs. Each entry is one chunk of
// imported places in public/<file>; the file name carries a content hash so it
// can be cached forever.
export const PLACE_PACK_ID_PREFIX = 'osm-';

export const PLACE_PACKS = ${JSON.stringify(packs, null, 2)};
`
);

// Report: count, photo share, 25 random places (seeded, so a re-run shows the same 25).
let seed = [...category].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const sample = [...places].sort(() => rand() - 0.5).slice(0, 25);
const withPhoto = places.filter((p) => p.images.length).length;
const report = {
  category,
  count: places.length,
  commonsPhotos: withPhoto,
  commonsPhotoPct: Math.round((withPhoto / places.length) * 1000) / 10,
  withFacts: places.filter((p) => p.facts.length).length,
  withHours: places.filter((p) => p.hours).length,
  // Without data/ no photo is re-checked, so the last real run's skips stay.
  photoSkips: fromPacks && fs.existsSync(`docs/miami-import/${category}.json`) ? JSON.parse(fs.readFileSync(`docs/miami-import/${category}.json`, 'utf8')).photoSkips : photoSkips,
  sample: sample.map((p) => ({ id: p.id, name: p.name, topic: p.topic, lat: p.lat, lng: p.lng, photo: !!p.images.length, facts: p.facts.slice(0, 3), osmUrl: p.osmUrl })),
  points: places.map((p) => [p.lat, p.lng, p.images.length ? 1 : 0]),
};
fs.mkdirSync('docs/miami-import', { recursive: true });
fs.writeFileSync(`docs/miami-import/${category}.json`, JSON.stringify(report, null, 1));
console.log(`${category}: ${report.count} places in ${entries.length} chunk(s); Commons photo ${report.commonsPhotos} (${report.commonsPhotoPct}%); facts ${report.withFacts}; hours ${report.withHours}`);
for (const s of report.sample) console.log(`  ${s.photo ? '[photo]' : '[tile] '} ${s.name} -- ${s.topic} -- ${s.facts.join('; ') || '(no facts)'}`);
