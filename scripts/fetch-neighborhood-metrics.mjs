#!/usr/bin/env node
// Raw numbers behind the Neighborhoods rating sliders (owner, 2026-11-06).
// Runs in GitHub Actions (.github/workflows/neighborhood-data.yml) because
// Geoapify and the Census API read their keys from the URL; the keys live in
// the repo secrets GEOAPIFY_API_KEY and CENSUS_API_KEY.
//
// For each neighborhood (src/data/miamiNeighborhoods.json):
// - Its area: the OpenStreetMap outline in scripts/neighborhoods/outlines.json
//   (from Nominatim) when there is one, else a 1 km circle around its center
//   (outlines.json can move a center, e.g. Coconut Grove to CocoWalk).
// - Geoapify Places inside that area: restaurants (+ their cuisines),
//   nightlife, shops, and art and culture places.
// - Census (ACS 5-year): median home value (B25077) and median gross rent
//   (B25064), each averaged over every tract whose internal point falls inside
//   the area (TIGERweb). Where TIGERweb gives nothing, the one tract at the
//   center (Census geocoder) stands in.
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

const OUTLINES = JSON.parse(readFileSync('scripts/neighborhoods/outlines.json', 'utf8'));

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

// Ray casting on [lng, lat] rings.
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeometry(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
}
function bboxOf(geom) {
  const pts = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).flatMap((p) => p[0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function countPlaces(area, categories) {
  const filter = area.geometry ? `rect:${bboxOf(area.geometry).join(',')}` : `circle:${area.lng},${area.lat},${CIRCLE_M}`;
  const seen = new Set();
  const cuisines = new Set();
  let fetched = 0;
  for (let offset = 0; offset < MAX_PER_GROUP; offset += 500) {
    const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=${filter}&limit=500&offset=${offset}&apiKey=${GEOAPIFY}`;
    const page = (await getJson(url)).features || [];
    fetched += page.length;
    for (const f of page) {
      const pt = f.geometry?.coordinates || [f.properties?.lon, f.properties?.lat];
      if (area.geometry && !inGeometry(pt, area.geometry)) continue;
      seen.add(f.properties?.place_id);
      const raw = f.properties?.catering?.cuisine || f.properties?.datasource?.raw?.cuisine || '';
      for (const c of String(raw).split(/[;,]/)) if (c.trim()) cuisines.add(c.trim().toLowerCase());
    }
    if (page.length < 500) break;
    await sleep(200);
  }
  return { count: seen.size, cuisines: [...cuisines].sort(), capped: fetched >= MAX_PER_GROUP };
}

async function tractOf({ lat, lng }) {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=Census%20Tracts`;
  const t = (await getJson(url)).result?.geographies?.['Census Tracts']?.[0];
  return t ? { geoid: t.GEOID, state: t.STATE, county: t.COUNTY, tract: t.TRACT } : null;
}

// Home value and rent for every tract in one county, keyed by 6-digit tract.
// The ACS marks suppressed values with large negative codes; 2000001 is its
// "$2,000,000 or more" top code, kept as is.
const countyCache = new Map();
async function countyTracts(state, county) {
  const key = `${state}${county}`;
  if (!countyCache.has(key)) {
    const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=B25077_001E,B25064_001E&for=tract:*&in=state:${state}%20county:${county}&key=${CENSUS}`;
    const rows = await getJson(url);
    const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    countyCache.set(key, new Map(rows.slice(1).map((r) => [r[3], { home: pos(r[0]), rent: pos(r[1]) }])));
  }
  return countyCache.get(key);
}

// Internal point of every tract in a county (TIGERweb).
const tractPoints = new Map();
async function pointsIn(state, county) {
  const key = `${state}${county}`;
  if (!tractPoints.has(key)) {
    const where = encodeURIComponent(`STATE='${state}' AND COUNTY='${county}'`);
    const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=${where}&outFields=TRACT,INTPTLAT,INTPTLON&returnGeometry=false&resultRecordCount=2000&f=json`;
    const feats = (await getJson(url)).features || [];
    tractPoints.set(key, feats.map((f) => ({ tract: f.attributes.TRACT, lat: +f.attributes.INTPTLAT, lng: +f.attributes.INTPTLON })));
  }
  return tractPoints.get(key);
}
const metersBetween = (a, b) => {
  const r = Math.PI / 180;
  const dx = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const dy = (b.lat - a.lat) * r;
  return Math.hypot(dx, dy) * 6371008.8;
};

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// { medianHomeValue, medianRent, tracts }, averaged over the area's tracts
// (the outline, else the 1 km circle); the center tract when TIGERweb fails.
async function censusFor(area, center, t) {
  if (!t) return { medianHomeValue: null, medianRent: null, tracts: 0 };
  const values = await countyTracts(t.state, t.county);
  let ids = [];
  try {
    const pts = await pointsIn(t.state, t.county);
    ids = pts
      .filter((p) => (area.geometry ? inGeometry([p.lng, p.lat], area.geometry) : metersBetween(center, p) <= CIRCLE_M))
      .map((p) => p.tract);
  } catch (e) {
    console.warn(`TIGERweb failed (${e.message}); using the center tract`);
  }
  if (!ids.length) ids = [t.tract];
  const rows = ids.map((id) => values.get(id)).filter(Boolean);
  return {
    medianHomeValue: mean(rows.map((r) => r.home).filter((v) => v != null)),
    medianRent: mean(rows.map((r) => r.rent).filter((v) => v != null)),
    tracts: ids.length,
  };
}

const out = {
  fetchedAt: new Date().toISOString(),
  sources: {
    places: 'Geoapify Places API (OpenStreetMap data), https://apidocs.geoapify.com/docs/places/',
    areas: 'OpenStreetMap outlines via Nominatim (scripts/neighborhoods/outlines.json), else a 1 km circle',
    homeValue: `U.S. Census Bureau, ACS ${ACS_YEAR} 5-year, B25077 median home value and B25064 median gross rent, averaged over the census tracts inside the area (TIGERweb tract points), else the tract at the center`,
  },
  groups: GROUPS,
  neighborhoods: {},
};

for (const n of DATA.neighborhoods) {
  if (!n.location) {
    console.warn(`${n.name}: no location, skipped`);
    continue;
  }
  const outline = OUTLINES.outlines[n.name];
  const center = OUTLINES.centers[n.name] || n.location;
  const area = outline ? { geometry: outline.geometry } : { lat: center.lat, lng: center.lng };
  const row = {
    area: outline
      ? { kind: 'outline', name: outline.name, osm: outline.osm, km2: +areaKm2(outline.geometry).toFixed(3) }
      : { kind: 'circle', center: [center.lat, center.lng], km2: +((Math.PI * CIRCLE_M * CIRCLE_M) / 1e6).toFixed(3) },
  };
  for (const [key, categories] of Object.entries(GROUPS)) {
    const r = await countPlaces(area, categories);
    row[key] = r.count;
    if (r.capped) row[`${key}Capped`] = true;
    if (key === 'restaurants') row.cuisines = r.cuisines;
  }
  const tract = await tractOf(n.location).catch(() => null);
  row.tract = tract?.geoid ?? null;
  Object.assign(row, await censusFor(area, center, tract).catch(() => ({ medianHomeValue: null, medianRent: null, tracts: 0 })));
  out.neighborhoods[n.name] = row;
  console.log(
    `${n.name}: ${row.area.kind}${row.area.name ? ` "${row.area.name}"` : ''} ${row.area.km2} km2 | ${row.restaurants} restaurants, ${row.cuisines.length} cuisines, ${row.nightlife} nightlife, ${row.shopping} shops, ${row.artAndCulture} culture, home $${row.medianHomeValue}, rent $${row.medianRent} (${row.tracts} tracts)`
  );
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT}`);
