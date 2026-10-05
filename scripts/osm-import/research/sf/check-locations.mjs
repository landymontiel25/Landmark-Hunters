// Location check for the San Francisco import: every staged place must sit
// inside the City and County of San Francisco (its OSM county boundary) and on
// land (the land side of OSM's coastline, which runs with land on its left),
// or on a pier. Pulls the boundary, coastline and piers once into
// data/san-francisco/land.json, then lists every place that fails.
//   node scripts/osm-import/research/sf/check-locations.mjs
import fs from 'node:fs';
import { distanceMeters, insideShape, outerRings } from '../../transform.js';

const DIR = 'scripts/osm-import/data/san-francisco';
const CACHE = `${DIR}/land.json`;
const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com)';
const BBOX = '37.69,-122.53,37.83,-122.34';

if (!fs.existsSync(CACHE)) {
  const query = `[out:json][timeout:180];(rel["boundary"="administrative"]["admin_level"="6"]["name"="San Francisco"];way["natural"="coastline"](${BBOX});wr["man_made"="pier"](${BBOX}););out geom;`;
  let data;
  for (let attempt = 1; !data; attempt++) {
    try {
      const r = await fetch('https://overpass.private.coffee/api/interpreter', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240000) });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      data = await r.json();
    } catch (e) {
      if (attempt >= 10) throw e;
      console.warn(`attempt ${attempt}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 20000));
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify(data.elements));
}
const elements = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const boundary = outerRings(elements.find((e) => e.type === 'relation' && e.tags?.boundary === 'administrative') || {});
const piers = elements.filter((e) => e.tags?.man_made === 'pier').flatMap(outerRings);
const coast = elements.filter((e) => e.tags?.natural === 'coastline').map((e) => e.geometry.map((p) => [p.lat, p.lon]));
if (!boundary.length || !coast.length) throw new Error('no boundary or coastline in land.json');

// Nearest coastline segment to the point, and which side of it the point is
// on: positive = left = land.
function coastSide(lat, lng) {
  let best = { d: Infinity, side: 0 };
  const k = Math.cos((lat * Math.PI) / 180);
  for (const line of coast)
    for (let i = 1; i < line.length; i++) {
      const [ay, ax] = line[i - 1];
      const [by, bx] = line[i];
      const dx = (bx - ax) * k;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-18;
      const t = Math.max(0, Math.min(1, (((lng - ax) * k) * dx + (lat - ay) * dy) / len2));
      const py = ay + t * dy;
      const px = ax + (t * dx) / k;
      const d = distanceMeters(lat, lng, py, px);
      if (d < best.d) best = { d, side: dx * (lat - ay) - dy * ((lng - ax) * k) };
    }
  return best;
}

const staged = JSON.parse(fs.readFileSync(`${DIR}/staged.json`, 'utf8'));
const problems = [];
for (const p of staged) {
  if (!boundary.some((r) => insideShape(p.lat, p.lng, r))) problems.push(`outside the city limits: ${p.id} ${p.name} ${p.lat},${p.lng}`);
  const c = coastSide(p.lat, p.lng);
  const onPier = piers.some((r) => insideShape(p.lat, p.lng, r));
  // The side test only means something near the shore; ships float and a
  // beach or a waterfront building can sit within mapping error (25 m) of
  // the line.
  const afloat = p.topic === 'historic ship' || p.topic === 'beach';
  if (c.side < 0 && c.d <= 150 && c.d > 25 && !onPier && !afloat) problems.push(`water side of the coastline (${Math.round(c.d)} m out): ${p.id} ${p.name} ${p.lat},${p.lng}`);
}
console.log(`${staged.length} places checked against the city boundary, ${coast.length} coastline ways and ${piers.length} piers: ${problems.length} problems`);
for (const x of problems) console.log('  ' + x);
