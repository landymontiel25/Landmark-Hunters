#!/usr/bin/env node
// Fills googlePlaceId and tripadvisorLocationId for every landmark
// (docs/ratings.md). Matches on name plus latitude/longitude; a match it is
// not sure about goes to a review file instead. Writes after every batch,
// so a crash or Ctrl-C loses at most one batch, and a re-run picks up where
// it stopped.
//
//   GOOGLE_PLACES_API_KEY=... TRIPADVISOR_API_KEY=... \
//     node scripts/match-rating-sources.mjs --batch=20 --limit=40 --region=philly
//
// Options:
//   --sources=google,tripadvisor   which sources to match (default both)
//   --batch=20                     landmarks per batch (writes after each)
//   --limit=N                      stop after N landmarks this run
//   --region=philly                only one region
//   --pause=300                    ms between API calls
//   --redo                         look up landmarks already matched or reviewed
//   --dry-run                      list what would be looked up; no API calls
//   --google-mode=nearby           use Google Nearby Search (the 20 places
//                                  closest to the landmark) instead of Text
//                                  Search; only sure matches are kept, the
//                                  rest are left for a Text Search run.
//                                  Useful when Text Search hits its daily cap.
//
// Outputs:
//   src/data/ratingSourceIds.json             sure matches ("region/id" -> IDs)
//   scripts/rating-sources/review.json        unsure matches, with candidates
//   scripts/rating-sources/no-match.json      nothing close by
//   scripts/rating-sources/tripadvisor-allowlist.txt
//       Tripadvisor location IDs to add to the Terra allowlist (Terra
//       answers 404 for any location not on it).
//
// What it stores is allowed by both sources' terms: Google place IDs may be
// kept indefinitely, Tripadvisor location IDs may be cached. No names,
// ratings or coordinates from either source are written to the ID map.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LANDMARKS, registerPlaces } from '../src/data/regions.js';
import { classifyMatch, SURE_RADIUS_M } from './rating-sources/match.js';
import { placeTypeFor } from '../src/lib/presence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = {
  ids: path.join(root, 'src/data/ratingSourceIds.json'),
  review: path.join(root, 'scripts/rating-sources/review.json'),
  none: path.join(root, 'scripts/rating-sources/no-match.json'),
  allowlist: path.join(root, 'scripts/rating-sources/tripadvisor-allowlist.txt'),
};
const FIELD = { google: 'googlePlaceId', tripadvisor: 'tripadvisorLocationId' };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SOURCES = String(args.sources || 'google,tripadvisor').split(',').filter((s) => FIELD[s]);
const BATCH = Math.max(1, Number(args.batch) || 20);
const LIMIT = Number(args.limit) || Infinity;
const PAUSE = Number(args.pause ?? 300);
const DRY = !!args['dry-run'];
const GOOGLE_NEARBY = args['google-mode'] === 'nearby';

const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every landmark: the catalog plus the imported place packs.
function allLandmarks() {
  const dir = path.join(root, 'public/places');
  for (const region of readdirSync(dir)) {
    if (!statSync(path.join(dir, region)).isDirectory()) continue;
    for (const f of readdirSync(path.join(dir, region))) registerPlaces(JSON.parse(readFileSync(path.join(dir, region, f), 'utf8')));
  }
  return ALL_LANDMARKS.filter((l) => l.id && l.name && Number.isFinite(l.lat) && Number.isFinite(l.lng)).map((l) => ({
    ...l,
    key: `${l.regionId ?? l.region}/${l.id}`,
  }));
}

// ---- Source searches: each returns [{ id, name, lat, lng }] -------------
const calls = { google: 0, tripadvisor: 0 };

// Places API (New) Text Search, biased to 250 m around the landmark. Field
// mask id + displayName + location (Text Search Pro).
// Nearby Search: Google's 20 most popular places inside the landmark's sure
// radius (closest-first misses landmarks in dense downtowns).
// Same Pro field mask; a different daily quota from Text Search.
async function searchGoogleNearby(l) {
  calls.google += 1;
  const radius = SURE_RADIUS_M[placeTypeFor(l)] || SURE_RADIUS_M.landmark;
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
    },
    body: JSON.stringify({
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      locationRestriction: { circle: { center: { latitude: l.lat, longitude: l.lng }, radius } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.places || []).map((p) => ({ id: p.id, name: p.displayName?.text, lat: p.location?.latitude, lng: p.location?.longitude }));
}

async function searchGoogle(l) {
  if (GOOGLE_NEARBY) return searchGoogleNearby(l);
  calls.google += 1;
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
    },
    body: JSON.stringify({
      textQuery: l.name,
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: l.lat, longitude: l.lng }, radius: 250 } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.places || []).map((p) => ({ id: p.id, name: p.displayName?.text, lat: p.location?.latitude, lng: p.location?.longitude }));
}

// Terra Catalog nearby search (not limited by the allowlist, which is the
// point: we are finding IDs to put on it). Parameter names follow Terra's
// "center point and radius" description but could not be confirmed from
// this repo's build environment; run --batch=1 --limit=1 first and check
// for a 400.
export function terraNearbyUrl(l) {
  const qs = new URLSearchParams({ version: '1', latitude: String(l.lat), longitude: String(l.lng), radius: '500', unit: 'm' });
  return `https://terra.tripadvisor.com/api/catalog/locations/nearby?${qs}`;
}
const terraName = (x) => {
  if (Array.isArray(x?.names)) return (x.names.find((n) => n.primary) || x.names[0])?.value;
  return x?.name;
};
async function searchTripadvisor(l) {
  calls.tripadvisor += 1;
  const r = await fetch(terraNearbyUrl(l), {
    headers: { 'X-API-Key': process.env.TRIPADVISOR_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`tripadvisor ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  const list = Array.isArray(body) ? body : body.data || body.locations || [];
  return list.map((x) => ({
    id: x.id ?? x.location_id,
    name: terraName(x),
    lat: Number(x.coordinates?.latitude ?? x.latitude),
    lng: Number(x.coordinates?.longitude ?? x.longitude),
  }));
}
const SEARCH = { google: searchGoogle, tripadvisor: searchTripadvisor };

// ---- Run ----------------------------------------------------------------
async function main() {
  for (const s of SOURCES) {
    const env = s === 'google' ? 'GOOGLE_PLACES_API_KEY' : 'TRIPADVISOR_API_KEY';
    if (!DRY && !process.env[env]) {
      console.error(`${env} is not set. Set it, drop --sources=${s}, or use --dry-run.`);
      process.exit(1);
    }
  }
  const ids = readJson(OUT.ids, {});
  const review = readJson(OUT.review, {});
  const none = readJson(OUT.none, {});

  const pending = [];
  for (const l of allLandmarks()) {
    if (args.region && (l.regionId ?? l.region) !== args.region) continue;
    const todo = SOURCES.filter((s) => args.redo || (!ids[l.key]?.[FIELD[s]] && !review[l.key]?.[s] && !none[l.key]?.includes(s)));
    if (todo.length) pending.push({ l, todo });
    if (pending.length >= LIMIT) break;
  }
  const perSource = Object.fromEntries(SOURCES.map((s) => [s, pending.filter((p) => p.todo.includes(s)).length]));
  console.log(`${pending.length} landmarks to look up. API calls this run: ${SOURCES.map((s) => `${s} ${perSource[s]}`).join(', ')}.`);
  if (DRY) {
    for (const { l, todo } of pending.slice(0, 20)) console.log(`  ${l.key}  (${todo.join(', ')})`);
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    return;
  }

  const tally = { sure: 0, review: 0, none: 0, errors: 0, deferred: 0 };
  // A source that hit its daily quota is skipped for the rest of the run
  // (Google: "... per day"; Terra: its daily call cap). Re-run tomorrow.
  const outOfQuota = new Set();
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    for (const { l, todo } of batch) {
      for (const s of todo) {
        if (outOfQuota.has(s)) continue;
        let verdict;
        try {
          verdict = classifyMatch(l, await SEARCH[s](l));
        } catch (e) {
          tally.errors += 1;
          if (/ 429/.test(e.message) && /per day|daily|quota/i.test(e.message)) {
            outOfQuota.add(s);
            console.warn(`  ${s}: daily quota reached. Stopping ${s} for this run; re-run tomorrow (or raise the quota) to continue.`);
          } else {
            console.warn(`  ${l.key} ${s}: ${e.message.split('\n')[0]}`);
            if (/ 429/.test(e.message)) await sleep(10000);
          }
          continue;
        } finally {
          await sleep(PAUSE);
        }
        if (s === 'google' && GOOGLE_NEARBY && verdict.status !== 'sure') {
          tally.deferred += 1; // left for a Text Search run
        } else if (verdict.status === 'sure') {
          ids[l.key] = { ...ids[l.key], [FIELD[s]]: verdict.id };
          tally.sure += 1;
        } else if (verdict.status === 'review') {
          review[l.key] = { ...review[l.key], name: l.name, lat: l.lat, lng: l.lng, [s]: { reason: verdict.reason, candidates: verdict.candidates } };
          tally.review += 1;
        } else {
          none[l.key] = [...new Set([...(none[l.key] || []), s])];
          tally.none += 1;
        }
      }
    }
    writeFileSync(OUT.ids, `${JSON.stringify(sortKeys(ids), null, 2)}\n`);
    writeFileSync(OUT.review, `${JSON.stringify(sortKeys(review), null, 2)}\n`);
    writeFileSync(OUT.none, `${JSON.stringify(sortKeys(none), null, 2)}\n`);
    const ta = [...new Set(Object.values(ids).map((v) => v.tripadvisorLocationId).filter(Boolean))].sort();
    writeFileSync(OUT.allowlist, ta.length ? `${ta.join('\n')}\n` : '');
    if (SOURCES.every((s) => outOfQuota.has(s))) {
      console.log('Every source hit its daily quota. Progress is saved; run the same command tomorrow.');
      break;
    }
    console.log(
      `batch ${i / BATCH + 1}: ${Math.min(i + BATCH, pending.length)}/${pending.length} done. ` +
        `sure ${tally.sure}, review ${tally.review}, no match ${tally.none}, errors ${tally.errors}${GOOGLE_NEARBY ? `, left for text search ${tally.deferred}` : ''}. ` +
        `API calls so far: google ${calls.google}, tripadvisor ${calls.tripadvisor}.`
    );
  }
  console.log(`Finished. Total API calls: google ${calls.google}, tripadvisor ${calls.tripadvisor}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
