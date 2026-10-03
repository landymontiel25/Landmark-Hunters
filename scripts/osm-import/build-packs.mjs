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

const category = process.argv[2];
if (!category) throw new Error('usage: build-packs.mjs <category>');
const REGION = 'miami';
const DIR = 'scripts/osm-import/data';
const CHUNK = 1500;
const LICENSE_OK = /^(public domain|cc0|cc[ -]by(?:[ -]sa)?\b|pd\b)/i;

const staged = JSON.parse(fs.readFileSync(`${DIR}/staged.json`, 'utf8')).filter((p) => p.categories[0] === category);
if (!staged.length) throw new Error(`no staged places in ${category}`);
const found = fs.existsSync(`${DIR}/commons.found.json`) ? JSON.parse(fs.readFileSync(`${DIR}/commons.found.json`, 'utf8')) : [];
const photoOf = new Map(found.filter((r) => r.status === 'found').map((r) => [r.id, r]));
const sameName = new Map();
for (const p of JSON.parse(fs.readFileSync(`${DIR}/staged.json`, 'utf8'))) sameName.set(p.name, (sameName.get(p.name) || 0) + 1);
// Photos rejected after looking at them (overrides.json rejectPhoto).
const overrides = JSON.parse(fs.readFileSync('scripts/osm-import/overrides.json', 'utf8'));
// Facts found by web research (scripts/osm-import/web-facts.json), each with
// the page that states it. They go first; OSM/Wikidata facts follow, with
// the street address last.
const webFacts = fs.existsSync('scripts/osm-import/web-facts.json') ? JSON.parse(fs.readFileSync('scripts/osm-import/web-facts.json', 'utf8')) : {};
const withWebFacts = (p) => {
  const web = (webFacts[p.id]?.facts || []).filter((f) => okWebFact(f));
  if (!web.length) return p;
  const seen = new Set(web.map((f) => f.text.toLowerCase()));
  const own = p.facts.filter((f) => !seen.has(f.toLowerCase()));
  const address = own.filter((f) => f.startsWith('Address: '));
  const facts = [...web.map((f) => f.text), ...own.filter((f) => !f.startsWith('Address: '))].slice(0, 7).concat(address);
  return { ...p, facts, factSources: Object.fromEntries(web.filter((f) => facts.includes(f.text)).map((f) => [f.text, f.url])) };
};
// Plain one-line statements with a real link; nothing that goes stale or
// reads as an opinion (prices, hours, phone numbers, star ratings).
export function okWebFact(f) {
  const text = String(f?.text || '').trim();
  return (
    text.length >= 12 &&
    text.length <= 160 &&
    /^https:\/\/[^\s"'<>]+$/.test(String(f?.url || '')) &&
    !/\$\s?\d|\b\d{3}[-.\s)]+\d{3}[-.\s]\d{4}\b|\b(stars?|rated|ratings?|reviews?|open(s)? (daily|from|until)|hours)\b|\u2014|\b(best|most popular|famous|iconic|must-visit|favorite)\b/i.test(text)
  );
}

// A Commons file is used by one place only, across the catalog and every pack.
const otherPackFiles = PLACE_PACKS.filter((p) => p.category !== category).map((p) => p.file);
const used = new Set(ALL_LANDMARKS.flatMap((l) => l.images || []));
for (const f of otherPackFiles) for (const p of JSON.parse(fs.readFileSync(path.join('public', f), 'utf8'))) for (const u of p.images) used.add(u);

const photoSkips = [];
const places = staged.map(withWebFacts).map((p) => {
  const r = photoOf.get(p.id);
  if (!r) return p;
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
  photoSkips,
  sample: sample.map((p) => ({ id: p.id, name: p.name, topic: p.topic, lat: p.lat, lng: p.lng, photo: !!p.images.length, facts: p.facts.slice(0, 3), osmUrl: p.osmUrl })),
  points: places.map((p) => [p.lat, p.lng, p.images.length ? 1 : 0]),
};
fs.mkdirSync('docs/miami-import', { recursive: true });
fs.writeFileSync(`docs/miami-import/${category}.json`, JSON.stringify(report, null, 1));
console.log(`${category}: ${report.count} places in ${entries.length} chunk(s); Commons photo ${report.commonsPhotos} (${report.commonsPhotoPct}%); facts ${report.withFacts}; hours ${report.withHours}`);
for (const s of report.sample) console.log(`  ${s.photo ? '[photo]' : '[tile] '} ${s.name} -- ${s.topic} -- ${s.facts.join('; ') || '(no facts)'}`);
