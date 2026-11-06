#!/usr/bin/env node
// Raw numbers behind the Neighborhoods rating sliders (owner, 2026-11-06).
// Runs in GitHub Actions (.github/workflows/neighborhood-data.yml) because
// Geoapify and the Census API read their keys from the URL; the keys live in
// the repo secrets GEOAPIFY_API_KEY and CENSUS_API_KEY.
//
// For each neighborhood's OpenStreetMap center (src/data/miamiNeighborhoods.json):
// - Geoapify Places: restaurants (+ their cuisines), nightlife, shops, art and
//   culture places within 1 km, and everyday places within 800 m (walkability).
// - Census: the tract at the center (Census geocoder) and its median home
//   value (ACS 5-year, table B25077).
// Writes scripts/neighborhoods/metrics.json. scripts/score-miami-neighborhoods.mjs
// turns it into 0-5 ratings.
import { readFileSync, writeFileSync } from 'node:fs';

const GEOAPIFY = process.env.GEOAPIFY_API_KEY;
const CENSUS = process.env.CENSUS_API_KEY;
if (!GEOAPIFY || !CENSUS) {
  console.error('Set GEOAPIFY_API_KEY and CENSUS_API_KEY.');
  process.exit(1);
}

const ACS_YEAR = 2023;
const DATA = JSON.parse(readFileSync('src/data/miamiNeighborhoods.json', 'utf8'));
const OUT = 'scripts/neighborhoods/metrics.json';

// Geoapify category groups (https://apidocs.geoapify.com/docs/places/#categories).
const GROUPS = {
  restaurants: { radius: 1000, categories: 'catering.restaurant,catering.cafe,catering.fast_food,catering.food_court' },
  nightlife: { radius: 1000, categories: 'catering.bar,catering.pub,catering.biergarten,adult.nightclub' },
  shopping: { radius: 1000, categories: 'commercial' },
  artAndCulture: { radius: 1000, categories: 'entertainment.culture,entertainment.museum,tourism.attraction.artwork' },
  // Everyday places a walk can reach: food, shops, services, schools,
  // health, parks and transit stops.
  walkable: {
    radius: 800,
    categories: 'catering,commercial,service,education,healthcare,leisure.park,public_transport,entertainment',
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= tries || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${url.replace(/(apiKey|key)=[^&]+/, '$1=***')}`);
    await sleep(1500 * i);
  }
}

// Every place in the group within the radius (Geoapify pages at 500).
async function places({ lat, lng }, { radius, categories }) {
  const all = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lng},${lat},${radius}&limit=500&offset=${offset}&apiKey=${GEOAPIFY}`;
    const page = (await getJson(url)).features || [];
    all.push(...page);
    if (page.length < 500) break;
    await sleep(250);
  }
  return all;
}

function cuisinesOf(features) {
  const set = new Set();
  for (const f of features) {
    const raw = f.properties?.catering?.cuisine || f.properties?.datasource?.raw?.cuisine || '';
    for (const c of String(raw).split(/[;,]/)) {
      const v = c.trim().toLowerCase();
      if (v) set.add(v);
    }
  }
  return [...set].sort();
}

async function tractOf({ lat, lng }) {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=Census%20Tracts`;
  const t = (await getJson(url)).result?.geographies?.['Census Tracts']?.[0];
  return t ? { geoid: t.GEOID, state: t.STATE, county: t.COUNTY, tract: t.TRACT } : null;
}

async function medianHomeValue(t) {
  const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=B25077_001E&for=tract:${t.tract}&in=state:${t.state}%20county:${t.county}&key=${CENSUS}`;
  const rows = await getJson(url);
  const v = Number(rows?.[1]?.[0]);
  // The ACS marks suppressed values with large negative codes.
  return Number.isFinite(v) && v > 0 ? v : null;
}

const out = {
  fetchedAt: new Date().toISOString(),
  sources: {
    places: 'Geoapify Places API (OpenStreetMap data), https://apidocs.geoapify.com/docs/places/',
    homeValue: `U.S. Census Bureau, ACS ${ACS_YEAR} 5-year, B25077 median home value, census tract at the neighborhood center`,
  },
  groups: GROUPS,
  neighborhoods: {},
};

for (const n of DATA.neighborhoods) {
  if (!n.location) {
    console.warn(`${n.name}: no location, skipped`);
    continue;
  }
  const row = {};
  for (const [key, group] of Object.entries(GROUPS)) {
    const feats = await places(n.location, group);
    row[key] = new Set(feats.map((f) => f.properties?.place_id)).size;
    if (key === 'restaurants') row.cuisines = cuisinesOf(feats);
  }
  const tract = await tractOf(n.location).catch(() => null);
  row.tract = tract?.geoid ?? null;
  row.medianHomeValue = tract ? await medianHomeValue(tract).catch(() => null) : null;
  out.neighborhoods[n.name] = row;
  console.log(`${n.name}: ${row.restaurants} restaurants, ${row.cuisines.length} cuisines, ${row.nightlife} nightlife, ${row.shopping} shops, ${row.artAndCulture} culture, ${row.walkable} walkable, home $${row.medianHomeValue}`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT}`);
