// Builds the water maps boat routes follow (src/lib/boatRoute.js), one per
// island area, from OpenStreetMap's coastline (owner, 2026-11-23: a boat
// route goes around the islands, never across land).
//
//   node scripts/water-grid/build-water-grid.mjs [area] [--from coast.json]
//
// For each area: every natural=coastline way in its box is drawn onto a
// grid of CELL_M cells, then water is filled in from the open-ocean corners
// of the box (4-connected, so it can't slip through a diagonal gap in a
// drawn coastline). Whatever the fill doesn't reach (inside an island's
// coastline) is land, and so are the coastline cells themselves. The grid
// is saved run-length encoded to public/water/<area>.json.
//
// No coordinate here is a place: the boxes only frame each area, and the
// seeds are corners of those boxes, out in open water.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CELL_M = 75;

export const AREAS = {
  // The Abacos: Little Abaco and Great Abaco's north end, the Sea of Abaco
  // and the cays from Walker's Cay down past Little Harbour.
  abacos: { south: 26.15, west: -77.7, north: 27.1, east: -76.8, seeds: ['ne', 'nw', 'sw'] },
  // Biscayne Bay around Key Biscayne and Virginia Key.
  biscayne: { south: 25.55, west: -80.35, north: 25.92, east: -80.05, seeds: ['ne', 'se'] },
};

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'landmarkhunters-water-grid/1.0 (+https://landmarkhunters.com)';

async function fetchCoast(a) {
  const q = `[out:json][timeout:190];way["natural"="coastline"](${a.south},${a.west},${a.north},${a.east});out geom;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}` });
      if (r.ok) return await r.json();
    } catch {
      /* try the next mirror */
    }
    await new Promise((res) => setTimeout(res, 15000 * (attempt + 1)));
  }
  throw new Error('Overpass did not answer');
}

export function gridShape(a) {
  const midLat = ((a.south + a.north) / 2) * (Math.PI / 180);
  const dLat = CELL_M / 111320;
  const dLng = CELL_M / (111320 * Math.cos(midLat));
  const rows = Math.ceil((a.north - a.south) / dLat);
  const cols = Math.ceil((a.east - a.west) / dLng);
  return { dLat, dLng, rows, cols };
}

export function buildGrid(a, coast) {
  const { dLat, dLng, rows, cols } = gridShape(a);
  const n = rows * cols;
  const shore = new Uint8Array(n);
  const toCell = (lat, lng) => [(a.north - lat) / dLat, (lng - a.west) / dLng];
  // Draw each segment by stepping at a quarter cell, so no cell it crosses
  // is skipped (a thin line stays a closed wall).
  for (const w of coast.elements || []) {
    const g = w.geometry || [];
    for (let i = 1; i < g.length; i++) {
      const [r0, c0] = toCell(g[i - 1].lat, g[i - 1].lon);
      const [r1, c1] = toCell(g[i].lat, g[i].lon);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) * 4));
      for (let s = 0; s <= steps; s++) {
        const r = Math.floor(r0 + ((r1 - r0) * s) / steps);
        const c = Math.floor(c0 + ((c1 - c0) * s) / steps);
        if (r >= 0 && r < rows && c >= 0 && c < cols) shore[r * cols + c] = 1;
      }
    }
  }
  const water = new Uint8Array(n);
  const corner = { ne: [0, cols - 1], nw: [0, 0], se: [rows - 1, cols - 1], sw: [rows - 1, 0] };
  const stack = [];
  for (const s of a.seeds) {
    const [r, c] = corner[s];
    const i = r * cols + c;
    if (!shore[i] && !water[i]) {
      water[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const r = (i / cols) | 0;
    const c = i - r * cols;
    const next = [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1];
    for (const j of next) {
      if (j >= 0 && !water[j] && !shore[j]) {
        water[j] = 1;
        stack.push(j);
      }
    }
  }
  // Run lengths, starting with land: [land, water, land, water, ...].
  const runs = [];
  let cur = 0;
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (water[i] === cur) len++;
    else {
      runs.push(len);
      cur = water[i];
      len = 1;
    }
  }
  runs.push(len);
  let waterCells = 0;
  for (let i = 0; i < n; i++) waterCells += water[i];
  return { south: a.south, west: a.west, north: a.north, east: a.east, cellMeters: CELL_M, rows, cols, runs, waterShare: +(waterCells / n).toFixed(3) };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((x) => !x.startsWith('--'));
  const fromIdx = args.indexOf('--from');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, '../../public/water');
  // (also writes api/_lib/water/<area>.js)
  mkdirSync(outDir, { recursive: true });
  for (const [name, a] of Object.entries(AREAS)) {
    if (only && only !== name) continue;
    const coast = fromIdx >= 0 ? JSON.parse(readFileSync(args[fromIdx + 1], 'utf8')) : await fetchCoast(a);
    const grid = buildGrid(a, coast);
    const file = path.join(outDir, `${name}.json`);
    const json = JSON.stringify({ area: name, source: 'OpenStreetMap natural=coastline (ODbL)', builtAt: new Date().toISOString().slice(0, 10), ...grid });
    writeFileSync(file, json);
    // The same grid for the server (Mapr's boat times), bundled with the
    // functions: fetching the site's own file from a function isn't reliable.
    const apiFile = path.resolve(here, `../../api/_lib/water/${name}.js`);
    mkdirSync(path.dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, `// Generated by scripts/water-grid/build-water-grid.mjs -- do not edit.\nexport default ${json};\n`);
    console.log(`${name}: ${grid.rows}x${grid.cols} cells, ${grid.runs.length} runs, ${Math.round(grid.waterShare * 100)}% water -> ${file}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
