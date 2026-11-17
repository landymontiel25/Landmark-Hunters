// After editing pack files in public/places/ in place (apply-pack-photos.mjs),
// renames each changed file to its new content hash and updates
// src/data/placePacks.manifest.js, the same naming build-packs.mjs uses. The
// hash in the name is what lets browsers and the offline map cache a pack
// forever, so an edited pack must get a new name or cached visitors would
// never see the change.
//   node scripts/rehash-packs.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PLACE_PACKS } from '../src/data/placePacks.manifest.js';

let renamed = 0;
const packs = PLACE_PACKS.map((entry) => {
  const full = `public/${entry.file}`;
  const body = fs.readFileSync(full, 'utf8');
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
  const file = entry.file.replace(/\.[0-9a-f]{10}\.json$/, `.${hash}.json`);
  if (file === entry.file) return entry;
  fs.renameSync(full, `public/${file}`);
  renamed++;
  return { ...entry, file };
});
const src = fs.readFileSync('src/data/placePacks.manifest.js', 'utf8');
const at = src.indexOf('export const PLACE_PACKS = ');
fs.writeFileSync('src/data/placePacks.manifest.js', `${src.slice(0, at)}export const PLACE_PACKS = ${JSON.stringify(packs, null, 2)};\n`);
console.log(`renamed ${renamed} pack file(s)`);
