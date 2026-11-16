// Applies find-pack-photos.mjs results to the pack JSON files directly
// (images + inline imageCredits, matching the shape every other imported
// place with a Commons photo already uses). Only places with no photo yet
// are touched.
//   node scripts/apply-pack-photos.mjs out/pack-miami.found.json [out/pack-philly.found.json ...]
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) throw new Error('usage: apply-pack-photos.mjs <found.json> [...]');

const LICENSE_OK = /^(public domain|cc0|cc[ -]by(?:[ -]sa)?\b|pd\b)/i;
const NONFREE = /\b(nc|nd)\b/i;

const usedUrls = new Set();
// Every pack file touched gets re-read fresh (not cached) in case the same
// file is mentioned by two different found.json runs.
const fileCache = new Map();
function loadFile(path) {
  if (!fileCache.has(path)) fileCache.set(path, { data: JSON.parse(fs.readFileSync(path, 'utf8')), dirty: false });
  return fileCache.get(path);
}
// Prime usedUrls from every photo already stored, across every region, so a
// Commons file never ends up on two different places.
for (const region of fs.readdirSync('public/places').filter((d) => !d.startsWith('.'))) {
  for (const f of fs.readdirSync(`public/places/${region}`).filter((n) => n.endsWith('.json'))) {
    const entry = loadFile(`public/places/${region}/${f}`);
    const arr = Array.isArray(entry.data) ? entry.data : entry.data.places || [];
    for (const p of arr) for (const u of p.images || []) usedUrls.add(u);
  }
}

const accepted = [];
const rejected = [];
let applied = 0;
for (const resultFile of files) {
  const found = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  for (const r of found) {
    const key = `${r.region}/${r.id}`;
    const why = (m) => rejected.push(`${key}: ${m}`);
    if (r.status !== 'found') continue;
    if (!r.file || r.index == null) { why('missing file/index'); continue; }
    if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^\s"'\\]+$/.test(r.imageUrl || '')) { why('bad imageUrl'); continue; }
    if (!/\.(jpe?g|png)(\?|$)/i.test(r.imageUrl)) { why('not jpg/png'); continue; }
    if (!LICENSE_OK.test(String(r.license || '').trim()) || NONFREE.test(r.license)) { why(`license ${r.license}`); continue; }
    if (r.license && !/^(public domain|cc0|pd)/i.test(r.license) && !r.author) { why('license needs an author'); continue; }
    if (usedUrls.has(r.imageUrl)) { why('file already used by another place'); continue; }

    const entry = loadFile(r.file);
    const arr = Array.isArray(entry.data) ? entry.data : entry.data.places || [];
    const place = arr[r.index];
    if (!place || place.id !== r.id) { why(`index ${r.index} in ${r.file} is not ${r.id} (the pack file changed since the lookup ran, re-run find-pack-photos.mjs)`); continue; }
    if (place.images?.length) { why('already has a photo'); continue; }

    usedUrls.add(r.imageUrl);
    place.images = [r.imageUrl];
    place.imageCredits = { ...(place.imageCredits || {}), [r.imageUrl]: { author: String(r.author || '').slice(0, 200), license: r.license, licenseUrl: r.licenseUrl || '', pageUrl: r.pageUrl || '' } };
    entry.dirty = true;
    applied++;
    accepted.push(key);
  }
}
// Pack files are minified single-line JSON, no trailing newline (owner's
// existing convention); rewritten the same way so a diff shows only the
// changed place's images/imageCredits, not a reformat of the whole file.
for (const [path, entry] of fileCache) {
  if (!entry.dirty) continue;
  fs.writeFileSync(path, JSON.stringify(entry.data));
}
console.log(JSON.stringify({ applied, rejectedCount: rejected.length, rejectedSample: rejected.slice(0, 20) }, null, 1));
