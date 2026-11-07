#!/usr/bin/env node
// Raw numbers behind the Neighborhoods rating sliders (owner, 2026-11-06).
// Runs in GitHub Actions (.github/workflows/neighborhood-data.yml) because
// Geoapify and the Census API read their keys from the URL; the keys live in
// the repo secrets GEOAPIFY_API_KEY and CENSUS_API_KEY.
//
// For each neighborhood (src/data/miamiNeighborhoods.json):
// - Its outline: Geoapify's Boundaries API lists the boundaries containing the
//   neighborhood's OpenStreetMap center; the one whose name matches is used.
//   No match: a 1 km circle around the center (recorded as such).
// - Geoapify Places inside that outline: restaurants (+ their cuisines),
//   nightlife, shops, and art and culture places, plus the outline's area so
//   the scores can use places per km2.
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
const CIRCLE_M = 1000;
// Counting stops here per group; on a log scale more changes little, and it
// keeps a big city inside Geoapify's free daily credits.
const MAX_PER_GROUP = 3000;

// Geoapify category groups (https://apidocs.geoapify.com/docs/places/#categories).
const GROUPS = {
  restaurants: 'catering.restaurant,catering.cafe,catering.fast_food,catering.food_court',
  nightlife: 'catering.bar,catering.pub,catering.biergarten,adult.nightclub',
  shopping: 'commercial',
  artAndCulture: 'entertainment.culture,entertainment.museum,tourism.attraction.artwork',
};

// Boundary names that differ from ours (OpenStreetMap spelling).
const ALIASES = {
  'Downtown Miami': ['downtown'],
  'Upper East Side': ['upper eastside', 'upper east side'],
  'Mid-Beach': ['mid-beach', 'middle beach', 'mid beach'],
  'South of Fifth': ['south pointe', 'south of fifth'],
  'Miami River District': ['lummus park', 'miami river'],
  Midtown: ['midtown', 'buena vista'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hide = (url) => url.replace(/(apiKey|key)=[^&]+/, '$1=***');

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= tries || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${hide(url)}`);
    await sleep(1500 * i);
  }
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function nameMatches(ours, theirs) {
  const t = norm(theirs);
  if (!t) return false;
  const wanted = [norm(ours), ...(ALIASES[ours] || []).map(norm)];
  return wanted.some((w) => t === w || t === `${w} miami` || t.startsWith(`${w} `) || t === w.replace(/^the /, ''));
}

// Area of a GeoJSON Polygon/MultiPolygon in km2 (spherical excess, good
// enough at neighborhood scale).
function areaKm2(geom) {
  const R = 6371.0088;
  const ring = (coords) => {
    let s = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      s += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
    }
    return Math.abs((s * R * R) / 2);
  };
  const poly = (rings) => ring(rings[0]) - rings.slice(1).reduce((a, r) => a + ring(r), 0);
  if (geom?.type === 'Polygon') return poly(geom.coordinates);
  if (geom?.type === 'MultiPolygon') return geom.coordinates.reduce((a, p) => a + poly(p), 0);
  return null;
}

// The boundary named like the neighborhood that contains its center.
async function outlineOf(n) {
  const { lat, lng } = n.location;
  const url = `https://api.geoapify.com/v1/boundaries/part-of?lat=${lat}&lon=${lng}&geometry=geometry_1000&apiKey=${GEOAPIFY}`;
  const feats = (await getJson(url)).features || [];
  const hits = feats
    .filter((f) => nameMatches(n.name, f.properties?.name) || nameMatches(n.name, f.properties?.name_international?.en))
    .map((f) => ({ placeId: f.properties.place_id, name: f.properties.name, area: areaKm2(f.geometry) }))
    .filter((h) => h.placeId && h.area && h.area > 0.05 && h.area < 400)
    .sort((a, b) => a.area - b.area);
  return hits[0] || null;
}

async function countPlaces(filter, categories) {
  const seen = new Set();
  const cuisines = new Set();
  for (let offset = 0; offset < MAX_PER_GROUP; offset += 500) {
    const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=${filter}&limit=500&offset=${offset}&apiKey=${GEOAPIFY}`;
    const page = (await getJson(url)).features || [];
    for (const f of page) {
      seen.add(f.properties?.place_id);
      const raw = f.properties?.catering?.cuisine || f.properties?.datasource?.raw?.cuisine || '';
      for (const c of String(raw).split(/[;,]/)) if (c.trim()) cuisines.add(c.trim().toLowerCase());
    }
    if (page.length < 500) break;
    await sleep(200);
  }
  return { count: seen.size, cuisines: [...cuisines].sort(), capped: seen.size >= MAX_PER_GROUP };
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
  // The ACS marks suppressed values with large negative codes; 2000001 is its
  // "$2,000,000 or more" top code, kept as is.
  return Number.isFinite(v) && v > 0 ? v : null;
}

const out = {
  fetchedAt: new Date().toISOString(),
  sources: {
    places: 'Geoapify Places and Boundaries APIs (OpenStreetMap data), https://apidocs.geoapify.com/',
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
  const outline = await outlineOf(n).catch((e) => {
    console.warn(`${n.name}: boundary lookup failed (${e.message})`);
    return null;
  });
  const filter = outline ? `place:${outline.placeId}` : `circle:${n.location.lng},${n.location.lat},${CIRCLE_M}`;
  const row = {
    area: outline ? { kind: 'boundary', name: outline.name, km2: +outline.area.toFixed(3) } : { kind: 'circle', km2: +((Math.PI * CIRCLE_M * CIRCLE_M) / 1e6).toFixed(3) },
  };
  for (const [key, categories] of Object.entries(GROUPS)) {
    const r = await countPlaces(filter, categories);
    row[key] = r.count;
    if (r.capped) row[`${key}Capped`] = true;
    if (key === 'restaurants') row.cuisines = r.cuisines;
  }
  const tract = await tractOf(n.location).catch(() => null);
  row.tract = tract?.geoid ?? null;
  row.medianHomeValue = tract ? await medianHomeValue(tract).catch(() => null) : null;
  out.neighborhoods[n.name] = row;
  console.log(
    `${n.name}: ${row.area.kind}${row.area.name ? ` "${row.area.name}"` : ''} ${row.area.km2} km2 | ${row.restaurants} restaurants, ${row.cuisines.length} cuisines, ${row.nightlife} nightlife, ${row.shopping} shops, ${row.artAndCulture} culture, home $${row.medianHomeValue}`
  );
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT}`);
