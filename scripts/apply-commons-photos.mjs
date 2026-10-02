// Applies a folder of Wikimedia Commons lookup results (*.found.json) to the
// landmark data files and src/data/imageCredits.js.
//   node scripts/apply-commons-photos.mjs <dir>
// Only landmarks that have no photo yet are touched. A result is applied only
// when the file is on Commons, the license is public domain / CC0 / CC BY /
// CC BY-SA, and the same file is not already used by another landmark.
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LANDMARKS } from '../src/data/regions.js';

const dir = process.argv[2];
if (!dir) throw new Error('usage: apply-commons-photos.mjs <dir>');
const DATA = path.resolve('src/data');
const FILE_OF = {
  'key-biscayne': 'keybiscayne', 'coral-gables': 'coralgables', 'el-escorial': 'elescorial', 'lake-como': 'lakecomo',
  'san-francisco': 'sanfrancisco', 'silicon-valley': 'siliconvalley', 'f1-circuits': 'f1', 'cape-town': 'capetown',
};
const LICENSE_OK = /^(public domain|cc0|cc[ -]by(?:[ -]sa)?\b|pd\b)/i;
const NONFREE = /\b(nc|nd)\b/i;

const have = new Map(ALL_LANDMARKS.map((l) => [`${l.regionId || l.region}/${l.id}`, l]));
const usedUrls = new Set(ALL_LANDMARKS.flatMap((l) => l.images || []));
const found = fs.readdirSync(dir).filter((f) => f.endsWith('.found.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const accepted = [];
const rejected = [];
for (const r of found) {
  const key = `${r.region}/${r.id}`;
  const lm = have.get(key);
  const why = (m) => rejected.push(`${key}: ${m}`);
  if (r.status !== 'found') continue;
  if (!lm) { why('unknown landmark'); continue; }
  if (lm.images?.length) { why('already has a photo'); continue; }
  if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^\s"'\\]+$/.test(r.imageUrl || '')) { why('bad imageUrl'); continue; }
  if (!/\.(jpe?g|png)(\?|$)/i.test(r.imageUrl)) { why('not jpg/png'); continue; }
  if (!LICENSE_OK.test(String(r.license || '').trim()) || NONFREE.test(r.license)) { why(`license ${r.license}`); continue; }
  if (r.license && !/^(public domain|cc0|pd)/i.test(r.license) && !r.author) { why('license needs an author'); continue; }
  if (usedUrls.has(r.imageUrl)) { why('file already used by another landmark'); continue; }
  usedUrls.add(r.imageUrl);
  accepted.push({ ...r, regionId: r.region });
}

const byFile = new Map();
for (const a of accepted) {
  const f = path.join(DATA, `landmarks.${FILE_OF[a.regionId] || a.regionId}.js`);
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(a);
}
let edited = 0;
for (const [f, list] of byFile) {
  let src = fs.readFileSync(f, 'utf8');
  for (const a of list) {
    const idLine = new RegExp(`^(\\s*)id: ['"]${a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"],\\n`, 'm');
    const m = idLine.exec(src);
    if (!m) { rejected.push(`${a.regionId}/${a.id}: id line not found in ${path.basename(f)}`); continue; }
    const start = m.index + m[0].length;
    const next = src.indexOf('\n  },', start);
    const block = src.slice(start, next < 0 ? undefined : next);
    const imgRe = /^(\s*)images: \[[^\]]*\],\n/m;
    const lit = `images: ['${a.imageUrl}'],`;
    if (imgRe.test(block)) {
      src = src.slice(0, start) + block.replace(imgRe, (_, ind) => `${ind}${lit}\n`) + src.slice(start + block.length);
    } else {
      src = src.slice(0, start) + `${m[1]}${lit}\n` + src.slice(start);
    }
    edited++;
  }
  fs.writeFileSync(f, src);
}

// Credits file: merge with what is there.
const credFile = path.join(DATA, 'imageCredits.js');
let existing = {};
if (fs.existsSync(credFile)) existing = (await import(`${credFile}?t=${Date.now()}`)).IMAGE_CREDITS || {};
for (const a of accepted) {
  existing[a.imageUrl] = { author: String(a.author || '').slice(0, 200), license: a.license, licenseUrl: a.licenseUrl || '', pageUrl: a.pageUrl || '' };
}
const body = Object.entries(existing).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync(credFile, `// Author and license for stored Wikimedia Commons photos (keyed by image URL).\n// Written by scripts/apply-commons-photos.mjs; shown under the photo by LandmarkPostcard.\nexport const IMAGE_CREDITS = {\n${body}\n};\n`);
console.log(JSON.stringify({ found: found.filter((r) => r.status === 'found').length, none: found.filter((r) => r.status !== 'found').length, applied: edited, rejected }, null, 1));
