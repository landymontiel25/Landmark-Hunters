// Finds a free-licensed Wikimedia Commons photo for every imported place
// pack that has no stored photo yet, the same way find-commons-photos.mjs
// does for the catalog -- but reading and matching against the already-built
// pack JSON in public/places/<region>/ directly, since the staged import
// files (scripts/osm-import/data/, gitignored) don't stick around after an
// import finishes.
//
//   node scripts/find-pack-photos.mjs miami out/pack-miami.found.json
//   node scripts/find-pack-photos.mjs philly out/pack-philly.found.json
//   node scripts/find-pack-photos.mjs villanova out/pack-villanova.found.json
//   node scripts/find-pack-photos.mjs san-francisco out/pack-sf.found.json
//   node scripts/find-pack-photos.mjs silicon-valley out/pack-sv.found.json
//
// Then: node scripts/apply-pack-photos.mjs out/pack-<region>.found.json
// Safe to re-run: places already found are skipped, so an interrupted run
// resumes. Owner's rule: every region's run stays within its own pack
// files; nothing here touches another region's places.
import fs from 'node:fs';
import path from 'node:path';
import { toCandidate, scoreCandidate, pickBest, resultFor, localEnough } from '../src/lib/commonsMatch.js';

// Pack folder -> the area words Commons text must contain when a file has
// no geotag (scripts/osm-import/regions.js's IMPORT_REGIONS[*].area).
const AREA = {
  miami:
    /\b(miami|coral gables|key biscayne|coconut grove|little havana|wynwood|brickell|south beach|virginia key|pinecrest|doral|hialeah|westchester|kendall|sweetwater|dade|biscayne)\b/,
  philly:
    /\b(philadelphia|philly|villanova|radnor|wayne|rosemont|bryn mawr|haverford|ardmore|narberth|wynnewood|merion|conshohocken|manayunk|roxborough|east falls|fishtown|kensington|northern liberties|old city|society hill|center city|rittenhouse|fairmount|university city|south philly|passyunk|delaware county|montgomery county|main line)\b/,
  villanova:
    /\b(philadelphia|philly|villanova|radnor|wayne|rosemont|bryn mawr|haverford|ardmore|narberth|wynnewood|merion|conshohocken|manayunk|roxborough|east falls|fishtown|kensington|northern liberties|old city|society hill|center city|rittenhouse|fairmount|university city|south philly|passyunk|delaware county|montgomery county|main line)\b/,
  'san-francisco':
    /\b(san francisco|sf|mission district|north beach|chinatown|soma|hayes valley|castro|haight|richmond district|sunset district|marina|pacific heights|nob hill|russian hill|dogpatch|jackson square|presidio|golden gate park|embarcadero|fisherman's wharf|noe valley|bernal heights|potrero hill|japantown|mission bay)\b/,
  'silicon-valley':
    /\b(palo alto|menlo park|atherton|woodside|portola valley|los altos|mountain view|sunnyvale|cupertino|santa clara|san jose|stanford|silicon valley)\b/,
};

const region = process.argv[2];
const outFile = process.argv[3];
if (!region || !AREA[region] || !outFile) {
  throw new Error(`usage: find-pack-photos.mjs <${Object.keys(AREA).join('|')}> <outFile>`);
}
const area = AREA[region];
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'LandmarkHunters-photo-finder/1.0 (https://landmarkhunters.com; https://github.com/landymontiel25/Landmark-Hunters)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch((e) => ({ status: 599, error: e }));
    if (r.status === 429 || r.status >= 500) {
      await sleep((Number(r.headers?.get?.('retry-after')) || 0) * 1000 || 5000 * 2 ** attempt);
      continue;
    }
    if (!r.ok) throw new Error(`Commons API ${r.status}`);
    await sleep(150);
    return r.json();
  }
  throw new Error('Commons API kept failing');
}

const meters = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const IMAGEINFO = { prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|size|mime', colimit: 'max' };

async function candidatesFor(l) {
  const geo = await api({ action: 'query', generator: 'geosearch', ggscoord: `${l.lat}|${l.lng}`, ggsradius: '150', ggsnamespace: '6', ggslimit: '30', ...IMAGEINFO });
  const search = await api({ action: 'query', generator: 'search', gsrsearch: `"${l.name}"`, gsrnamespace: '6', gsrlimit: '10', ...IMAGEINFO });
  const out = new Map();
  for (const [res, isGeo] of [[geo, true], [search, false]]) {
    for (const page of Object.values(res.query?.pages || {})) {
      const c = toCandidate(page);
      if (!c) continue;
      const co = page.coordinates?.[0];
      const dist = isGeo && co ? meters(l.lat, l.lng, co.lat, co.lon) : null;
      const prev = out.get(page.title);
      if (!prev || (dist != null && (prev.near == null || dist < prev.near))) out.set(page.title, { candidate: c, near: dist });
    }
  }
  return [...out.values()];
}

// Every pack JSON file for this region, and where each place lives (so
// apply-pack-photos.mjs can write back to the exact file).
function loadPlaces() {
  const dir = path.join('public/places', region);
  const places = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const full = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const arr = Array.isArray(data) ? data : data.places || [];
    arr.forEach((p, index) => places.push({ ...p, _file: full, _index: index }));
  }
  return places;
}

const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const have = new Map(done.map((r) => [r.id, r]));
const todo = loadPlaces().filter((p) => !(p.images && p.images.length));
console.log(`${region}: ${todo.length} places with no photo yet`);
let n = 0;
const queue = todo.filter((p) => {
  const prev = have.get(p.id);
  return !prev || (prev.status !== 'found' && /^lookup failed/.test(prev.why || ''));
});
// One at a time: Commons rate-limits bursts.
for (const p of queue) {
  let result;
  try {
    const cands = await candidatesFor(p);
    const scored = cands
      .filter((c) => localEnough(p, c.candidate, c.near, area))
      .map((c) => ({ candidate: c.candidate, near: c.near != null && c.near <= 150, score: scoreCandidate(p, c.candidate, c.near) }));
    result = resultFor({ ...p, region }, pickBest(p, scored));
    if (result.status === 'found') result.near = undefined;
    result.file = p._file;
    result.index = p._index;
  } catch (e) {
    result = { region, id: p.id, name: p.name, status: 'none', why: `lookup failed: ${e.message}`, file: p._file, index: p._index };
  }
  have.set(p.id, result);
  n += 1;
  if (n % 10 === 0) fs.writeFileSync(outFile, JSON.stringify([...have.values()], null, 1));
  console.log(`${result.status === 'found' ? 'FOUND' : 'none '} ${region}/${p.id}${result.status === 'found' ? `  ${result.fileTitle}` : ''}  (${n}/${queue.length})`);
}
fs.writeFileSync(outFile, JSON.stringify([...have.values()], null, 1));
const all = [...have.values()];
console.log(`\n${region}: found ${all.filter((r) => r.status === 'found').length}, none ${all.filter((r) => r.status !== 'found').length}. Next: node scripts/apply-pack-photos.mjs ${outFile}`);
