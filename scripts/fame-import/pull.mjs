// Pulls, from Wikidata (CC0), how well known each landmark is, for the Top
// Landmarks order (owner, 2026-11-05: "how many visits each place gets").
//
// Two sourced numbers per place it can match:
//   n  how many language editions of Wikipedia have an article on it
//      (Wikidata `sitelinks`), a worldwide-fame measure
//   v  visitors per year (Wikidata P1174, newest dated value) where Wikidata
//      has one, with its year in vy
//   w  English Wikipedia page views over the last 12 full months (free,
//      CC0, from the Wikimedia page-view API), with the article title in wt.
//      A stand-in for how many people look a place up, not for visits.
// Wikidata does not hold visit counts for most places, and Google's terms
// forbid storing its data, so places with no match simply keep their old
// popularity score (src/lib/topRated.js).
//
// Matching: one bulk query per area (every Wikidata item with coordinates
// inside the area), then a local match on name and distance. No coordinate is
// typed by hand. A place with a `wikidata` id in its pack is matched by id.
//
// Run: node scripts/fame-import/pull.mjs   (needs network to query.wikidata.org,
// www.wikidata.org and wikimedia.org; it waits out their rate limits and takes
// a few minutes, and the page views a few more)
// Writes: src/data/placeFame.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'src/data/placeFame.json');
const UA = 'LandmarkHuntersBot/1.0 (https://github.com/landymontiel25/Landmark-Hunters) ranking-data-pull';
const SPARQL = 'https://query.wikidata.org/sparql';
const GAP_MS = 12000; // between queries, to stay under Wikidata's limit
const MAX_DISTANCE_M = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- the places ----
const { ALL_LANDMARKS } = await import(path.join(ROOT, 'src/data/regions.js'));
const places = new Map();
const add = (p) => {
  const region = p.regionId || p.region;
  if (!region || !p.id || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
  places.set(`${region}/${p.id}`, { key: `${region}/${p.id}`, region, name: p.name, lat: p.lat, lng: p.lng, qid: p.wikidata || null, categories: p.categories || [] });
};
for (const l of ALL_LANDMARKS) add(l);
const packsDir = path.join(ROOT, 'public/places');
for (const reg of fs.readdirSync(packsDir)) {
  const dir = path.join(packsDir, reg);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of Array.isArray(d) ? d : d.landmarks || d.places || []) add({ ...p, region: p.region || reg });
  }
}
log('places', places.size);

// ---- areas: one per region (the circuits category spans the world: skipped) ----
const byRegion = new Map();
for (const p of places.values()) {
  if (p.region === 'f1-circuits') continue;
  if (!byRegion.has(p.region)) byRegion.set(p.region, []);
  byRegion.get(p.region).push(p);
}
const areaOf = (list, pad = 0.03) => ({
  s: Math.min(...list.map((p) => p.lat)) - pad,
  n: Math.max(...list.map((p) => p.lat)) + pad,
  w: Math.min(...list.map((p) => p.lng)) - pad,
  e: Math.max(...list.map((p) => p.lng)) + pad,
});

// ---- Wikidata ----
async function runQuery(query) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let res;
    try {
      res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(100000) });
    } catch (e) {
      log('  network error, retrying:', e.message);
      await sleep(15000);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const wait = (Number(res.headers.get('retry-after')) || 30) + 5;
      log(`  rate limited, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 500 || res.status === 504) return { timedOut: true };
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    return { rows: (await res.json()).results.bindings };
  }
  throw new Error('Wikidata kept refusing');
}
const areaQuery = (a, minLinks) => `SELECT ?item ?label ?c ?n ?v ?t WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?c . bd:serviceParam wikibase:cornerSouthWest "Point(${a.w} ${a.s})"^^geo:wktLiteral . bd:serviceParam wikibase:cornerNorthEast "Point(${a.e} ${a.n})"^^geo:wktLiteral . }
  ?item wikibase:sitelinks ?n . FILTER(?n >= ${minLinks})
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?item p:P1174 ?st . ?st ps:P1174 ?v . OPTIONAL { ?st pq:P585 ?t } }
}`;
// An area that times out is split in four.
async function fetchArea(a, minLinks, depth = 0) {
  const r = await runQuery(areaQuery(a, minLinks));
  await sleep(GAP_MS);
  if (!r.timedOut) return r.rows;
  if (depth >= 3) {
    log('  area still too big, raising the bar to 10 language editions');
    const again = await runQuery(areaQuery(a, 10));
    await sleep(GAP_MS);
    return again.rows || [];
  }
  const mw = (a.w + a.e) / 2;
  const ms = (a.s + a.n) / 2;
  const parts = [{ ...a, e: mw, n: ms }, { ...a, w: mw, n: ms }, { ...a, e: mw, s: ms }, { ...a, w: mw, s: ms }];
  const out = [];
  for (const part of parts) out.push(...(await fetchArea(part, minLinks, depth + 1)));
  return out;
}

// ---- matching ----
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const STOP = new Set(['the', 'of', 'and', 'at', 'in', 'a', 'de', 'la', 'del', 'di', 'le', 'el']);
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t && !STOP.has(t)));
function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter += 1;
  const jaccard = inter / (x.size + y.size - inter);
  const containment = inter / Math.min(x.size, y.size);
  return Math.max(jaccard, containment >= 1 && inter >= 2 ? 0.8 : 0);
}
const meters = (aLat, aLng, bLat, bLng) => {
  const R = 6371000;
  const p = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * p) / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLng - aLng) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const fame = {};
const stats = { matched: 0, withVisits: 0 };
for (const [region, list] of byRegion) {
  const a = areaOf(list);
  const area = (a.n - a.s) * (a.e - a.w);
  const minLinks = area > 0.5 ? 8 : 3;
  log(`${region}: ${list.length} places, area ${area.toFixed(3)} deg2, min ${minLinks} editions`);
  const rows = await fetchArea(a, minLinks);
  // One record per Wikidata item (an item repeats once per visitor figure).
  const items = new Map();
  for (const r of rows) {
    const qid = r.item.value.split('/').pop();
    const m = /Point\(([-\d.e]+) ([-\d.e]+)\)/.exec(r.c.value);
    if (!m) continue;
    const it = items.get(qid) || { qid, label: r.label.value, lng: Number(m[1]), lat: Number(m[2]), n: Number(r.n.value), visits: null };
    if (r.v) {
      const year = r.t ? Number(r.t.value.slice(0, 4)) : 0;
      const amount = Number(r.v.value);
      if (amount > 0 && (!it.visits || year > it.visits.year)) it.visits = { amount, year };
    }
    items.set(qid, it);
  }
  log(`  ${items.size} Wikidata items`);
  const byQid = new Map([...items.values()].map((i) => [i.qid, i]));
  for (const p of list) {
    let hit = p.qid ? byQid.get(p.qid) : null;
    if (!hit) {
      let best = 0;
      for (const it of items.values()) {
        const d = meters(p.lat, p.lng, it.lat, it.lng);
        if (d > MAX_DISTANCE_M) continue;
        const sim = similarity(p.name, it.label);
        if (sim < 0.5) continue;
        const score = sim - d / 10000;
        if (score > best) {
          best = score;
          hit = it;
        }
      }
    }
    if (!hit) continue;
    stats.matched += 1;
    fame[p.key] = { q: hit.qid, n: hit.n, ...(hit.visits ? { v: hit.visits.amount, vy: hit.visits.year } : {}) };
    if (hit.visits) stats.withVisits += 1;
  }
  log(`  matched so far: ${stats.matched} (${stats.withVisits} with yearly visitors)`);
}

// ---- English Wikipedia page views (last 12 full months) ----
// Wikimedia limits an anonymous client to about 10 requests a minute and this
// connection is shared, so most answers are 429 "retry after 1s". The loop
// below retries each title patiently (it can take an hour in all), keeps what
// it has between runs (--resume) and saves as it goes.
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';
async function politeJson(url, { maxAttempts = 80 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    } catch {
      await sleep(10000);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get('retry-after')) || 1;
      await sleep(wait * 1000 + 1500 + Math.random() * 2500);
      continue;
    }
    if (!res.ok) return null; // 404: no page views recorded for that title
    return res.json().catch(() => null);
  }
  return null;
}
function lastTwelveMonths() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of last month
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  const f = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
  return { start: f(start), end: f(end) };
}
const save = () => {
  const sortedNow = Object.fromEntries(Object.entries(fame).sort(([x], [y]) => (x < y ? -1 : 1)));
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        _source: 'Wikidata (CC0), https://www.wikidata.org/wiki/<q>. n = language editions of Wikipedia with an article; v = visitors per year (P1174) in year vy; w = English Wikipedia page views in the last 12 full months for article wt (Wikimedia page-view API, https://wikimedia.org/api/rest_v1/).',
        _pulled: new Date().toISOString().slice(0, 10),
        places: sortedNow,
      },
      null,
      1
    ) + '\n'
  );
};
if (process.argv.includes('--resume') && fs.existsSync(OUT)) {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).places || {};
  for (const [k, f] of Object.entries(fame)) if (prev[k]?.w) { f.w = prev[k].w; f.wt = prev[k].wt; }
  log('resumed page views for', Object.values(fame).filter((f) => f.w).length, 'places');
}
if (process.argv.includes('--pageviews')) {
  save();
  const qids = [...new Set(Object.values(fame).map((f) => f.q))];
  const titleOf = new Map();
  log(`looking up English Wikipedia titles for ${qids.length} items`);
  for (let i = 0; i < qids.length; i += 50) {
    const chunk = qids.slice(i, i + 50);
    const d = await politeJson(`${WIKIDATA_API}?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${chunk.join('|')}`);
    for (const [q, e] of Object.entries(d?.entities || {})) if (e.sitelinks?.enwiki) titleOf.set(q, e.sitelinks.enwiki.title);
    await sleep(1500);
  }
  const have = new Set(Object.values(fame).filter((f) => f.w).map((f) => f.q));
  const todo = [...titleOf].filter(([q]) => !have.has(q));
  const { start, end } = lastTwelveMonths();
  log(`${titleOf.size} have an English article; ${todo.length} still need page views (${start}-${end})`);
  let done = 0;
  for (const [q, title] of todo) {
    const d = await politeJson(`${PAGEVIEWS}/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${start}/${end}`);
    const views = (d?.items || []).reduce((n, it) => n + (it.views || 0), 0);
    for (const f of Object.values(fame)) if (f.q === q && views > 0) { f.w = views; f.wt = title; }
    done += 1;
    if (done % 20 === 0) {
      log(`  page views: ${done}/${todo.length}`);
      save();
    }
    await sleep(900);
  }
}

save();
const sorted = fame;
log(`wrote ${Object.keys(sorted).length} places of ${places.size} to src/data/placeFame.json`);
