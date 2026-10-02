// Finds a free-licensed Wikimedia Commons photo for every landmark that has no
// stored photo, using the free Commons API (no key). Run on a machine with
// internet access:
//   node scripts/find-commons-photos.mjs out/            # writes out/commons.found.json
//   node scripts/apply-commons-photos.mjs out/           # edits the landmark data + credits
//   node scripts/find-commons-photos.mjs --places scripts/osm-import/data/staged.json scripts/osm-import/data/
//                                                        # OSM import: build-packs.mjs applies the results
// Then review the diff (git diff) before committing. Safe to re-run: landmarks
// already found in the output file are skipped, so an interrupted run resumes.
// A photo is only chosen when the file name/description/categories contain the
// landmark's distinctive name words AND (the name is in the file title OR the
// photo was taken within 150 m). Otherwise the landmark is left without one.
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LANDMARKS } from '../src/data/regions.js';
import { toCandidate, scoreCandidate, pickBest, resultFor, localEnough } from '../src/lib/commonsMatch.js';

// Imported places (--places) must also be shown to be in the right area.
const MIAMI_AREA = /\b(miami|coral gables|key biscayne|coconut grove|little havana|wynwood|brickell|south beach|virginia key|pinecrest|doral|hialeah|westchester|kendall|sweetwater|dade|biscayne)\b/;

// --places <file.json>: run over those places (the OSM import's staged list)
// instead of the catalog's photo-less landmarks.
const args = process.argv.slice(2);
const placesArg = args.indexOf('--places');
const placesFile = placesArg >= 0 ? args.splice(placesArg, 2)[1] : null;
const outDir = args[0] || 'out';
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'commons.found.json');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'LandmarkHunters-photo-finder/1.0 (https://landmarkhunters.com; https://github.com/landymontiel25/Landmark-Hunters)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch((e) => ({ status: 599, error: e }));
    if (r.status === 429 || r.status >= 500) {
      // Commons rate-limits bursts; wait as asked, or back off harder each time.
      await sleep((Number(r.headers?.get?.('retry-after')) || 0) * 1000 || 5000 * 2 ** attempt);
      continue;
    }
    if (!r.ok) throw new Error(`Commons API ${r.status}`);
    await sleep(150);
    return r.json();
  }
  throw new Error('Commons API kept failing');
}

async function candidatesFor(l) {
  const near = new Map(); // title -> meters
  const geo = await api({ action: 'query', list: 'geosearch', gscoord: `${l.lat}|${l.lng}`, gsradius: '150', gsnamespace: '6', gslimit: '30' });
  for (const g of geo.query?.geosearch || []) near.set(g.title, g.dist);
  const search = await api({ action: 'query', list: 'search', srsearch: `"${l.name}"`, srnamespace: '6', srlimit: '10' });
  const titles = new Set([...near.keys(), ...(search.query?.search || []).map((s) => s.title)]);
  const out = [];
  const list = [...titles];
  for (let i = 0; i < list.length; i += 20) {
    const info = await api({ action: 'query', titles: list.slice(i, i + 20).join('|'), prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime' });
    for (const page of Object.values(info.query?.pages || {})) {
      const c = toCandidate(page);
      if (c) out.push({ candidate: c, near: near.has(page.title) ? near.get(page.title) : null });
    }
  }
  return out;
}

const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const have = new Map(done.map((r) => [`${r.region}/${r.id}`, r]));
const source = placesFile ? JSON.parse(fs.readFileSync(placesFile, 'utf8')) : ALL_LANDMARKS;
const todo = source.filter((l) => !(l.images && l.images.length)).map((l) => ({ ...l, region: l.regionId || l.region }));
let n = 0;
// One place at a time: Commons rate-limits bursts (three at once failed a
// third of the lookups).
const CONCURRENCY = 1;
// Re-runs retry only lookups that failed; a real "no photo" result stays.
const queue = todo.filter((l) => {
  const prev = have.get(`${l.region}/${l.id}`);
  return !prev || (prev.status !== 'found' && /^lookup failed/.test(prev.why || ''));
});
async function worker() {
  for (let l = queue.shift(); l; l = queue.shift()) await findOne(l);
}
async function findOne(l) {
  const key = `${l.region}/${l.id}`;
  let result;
  try {
    const cands = await candidatesFor(l);
    const scored = cands
      .filter((c) => !placesFile || localEnough(l, c.candidate, c.near, MIAMI_AREA))
      .map((c) => ({ candidate: c.candidate, near: c.near != null && c.near <= 150, score: scoreCandidate(l, c.candidate, c.near) }));
    result = resultFor(l, pickBest(l, scored));
    if (result.status === 'found') result.near = undefined;
  } catch (e) {
    result = { region: l.region, id: l.id, name: l.name, status: 'none', why: `lookup failed: ${e.message}` };
  }
  have.set(key, result);
  if (++n % 10 === 0) fs.writeFileSync(outFile, JSON.stringify([...have.values()], null, 1));
  console.log(`${result.status === 'found' ? 'FOUND' : 'none '} ${key}${result.status === 'found' ? `  ${result.fileTitle}` : ''}`);
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
fs.writeFileSync(outFile, JSON.stringify([...have.values()], null, 1));
const all = [...have.values()];
console.log(`\nfound ${all.filter((r) => r.status === 'found').length}, none ${all.filter((r) => r.status !== 'found').length}. Next: node scripts/apply-commons-photos.mjs ${outDir}`);
