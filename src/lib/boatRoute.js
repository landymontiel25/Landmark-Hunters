import { distanceMeters } from './geo';

// Boat routes through the water, around the islands (owner, 2026-11-23:
// the road route service can't cross water, so Boat failed with "Our
// server is having trouble"; a boat route never crosses land). The water
// maps are built from OpenStreetMap's coastline by
// scripts/water-grid/build-water-grid.mjs into public/water/<area>.json: a
// grid of 75 m cells, water or land.
//
// A route: each end snaps to the nearest water (a dock or beach is on
// land), then the shortest path through water cells, 8 ways, never
// cutting a corner across land; then straightened wherever a straight run
// stays on water. Pure (grids passed in), so the app and Mapr's server
// measure a boat trip the same way.

export const WATER_AREAS = ['abacos', 'biscayne'];
// The farthest a stop may be from the water it's reached by.
const MAX_SNAP_M = 3000;
// Small-boat cruising speed for boat times: 9 m/s, about 17.5 knots
// (travelModes.js PACE.boat), plus 5 min to get under way.
export const BOAT_MPS = 9;
export const BOAT_WAIT_MIN = 5;

export function boatMinutes(meters) {
  return Math.max(1, Math.round(meters / BOAT_MPS / 60 + BOAT_WAIT_MIN));
}

// A grid file -> { ...meta, water: Uint8Array, dLat, dLng }.
export function decodeGrid(g) {
  const n = g.rows * g.cols;
  const water = new Uint8Array(n);
  let i = 0;
  let v = 0;
  for (const run of g.runs) {
    if (v) water.fill(1, i, Math.min(n, i + run));
    i += run;
    v ^= 1;
  }
  return { ...g, runs: undefined, water, dLat: (g.north - g.south) / g.rows, dLng: (g.east - g.west) / g.cols };
}

export function gridCovers(grid, p) {
  return p && p.lat <= grid.north && p.lat >= grid.south && p.lng >= grid.west && p.lng <= grid.east;
}

const cellOf = (g, p) => [Math.min(g.rows - 1, Math.max(0, Math.floor((g.north - p.lat) / g.dLat))), Math.min(g.cols - 1, Math.max(0, Math.floor((p.lng - g.west) / g.dLng)))];
const centerOf = (g, i) => {
  const r = (i / g.cols) | 0;
  const c = i - r * g.cols;
  return [g.north - (r + 0.5) * g.dLat, g.west + (c + 0.5) * g.dLng];
};

// The nearest water cell to p, searching outward ring by ring.
function snap(g, p) {
  const [r0, c0] = cellOf(g, p);
  const maxRing = Math.ceil(MAX_SNAP_M / g.cellMeters);
  for (let ring = 0; ring <= maxRing; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      if (r < 0 || r >= g.rows) continue;
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (c < 0 || c >= g.cols || (Math.abs(r - r0) !== ring && Math.abs(c - c0) !== ring)) continue;
        const i = r * g.cols + c;
        if (!g.water[i]) continue;
        const d = (r - r0) ** 2 + (c - c0) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// Min-heap of cell ids keyed by f.
class Heap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }
  get size() {
    return this.ids.length;
  }
  push(id, key) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop() {
    const { ids, keys } = this;
    const top = ids[0];
    const lastId = ids.pop();
    const lastKey = keys.pop();
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= ids.length) break;
        const r = l + 1;
        const m = r < ids.length && keys[r] < keys[l] ? r : l;
        if (keys[m] >= lastKey) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// Shortest water path between two water cells (A*, octile distance).
function aStar(g, from, to) {
  const { rows, cols, water } = g;
  const n = rows * cols;
  const gScore = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tr = (to / cols) | 0;
  const tc = to - tr * cols;
  const h = (i) => {
    const r = (i / cols) | 0;
    const dr = Math.abs(r - tr);
    const dc = Math.abs(i - r * cols - tc);
    return Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc);
  };
  const open = new Heap();
  gScore[from] = 0;
  open.push(from, h(from));
  const D = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [1, 1, Math.SQRT2],
  ];
  while (open.size) {
    const i = open.pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (const [dr, dc, cost] of D) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const j = rr * cols + cc;
      if (!water[j] || closed[j]) continue;
      // No cutting a corner across land.
      if (dr && dc && (!water[r * cols + cc] || !water[rr * cols + c])) continue;
      const t = gScore[i] + cost;
      if (t < gScore[j]) {
        gScore[j] = t;
        parent[j] = i;
        open.push(j, t + h(j));
      }
    }
  }
  if (from !== to && parent[to] < 0) return null;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(parent[path[path.length - 1]]);
  return path.reverse();
}

// Whether the straight run between two cells stays on water (sampled at a
// quarter cell, so it can't skip a cell of land).
function clear(g, a, b) {
  const ar = (a / g.cols) | 0;
  const ac = a - ar * g.cols;
  const br = (b / g.cols) | 0;
  const bc = b - br * g.cols;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(br - ar), Math.abs(bc - ac)) * 4));
  for (let s = 0; s <= steps; s++) {
    const r = Math.floor(ar + 0.5 + ((br - ar) * s) / steps);
    const c = Math.floor(ac + 0.5 + ((bc - ac) * s) / steps);
    if (!g.water[r * g.cols + c]) return false;
  }
  return true;
}

function straighten(g, path) {
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !clear(g, path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

/**
 * A boat route from a to b ({lat, lng}) on a decoded grid, or null when
 * either end is more than MAX_SNAP_M from water or the waters don't connect.
 * { points: [[lat, lng], ...], distanceMeters, minutes }.
 */
export function boatRouteOnGrid(grid, a, b) {
  if (!gridCovers(grid, a) || !gridCovers(grid, b)) return null;
  const s = snap(grid, a);
  const t = snap(grid, b);
  if (s < 0 || t < 0) return null;
  const cells = aStar(grid, s, t);
  if (!cells) return null;
  const water = straighten(grid, cells).map((i) => centerOf(grid, i));
  const points = [[a.lat, a.lng], ...water, [b.lat, b.lng]];
  let meters = 0;
  for (let k = 1; k < points.length; k++) meters += distanceMeters(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1]);
  meters = Math.round(meters);
  return { points, distanceMeters: meters, minutes: boatMinutes(meters) };
}

// The app's side: grids load once, on first use, from /water/<area>.json.
const loaded = new Map(); // area -> Promise<grid | null>
export function loadWaterGrid(area, fetchImpl = typeof fetch === 'function' ? fetch : null) {
  if (!loaded.has(area)) {
    const p = fetchImpl
      ? fetchImpl(`/water/${area}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .then((g) => (g ? decodeGrid(g) : null))
          .catch(() => null)
      : Promise.resolve(null);
    loaded.set(area, p);
    p.then((g) => !g && loaded.delete(area));
  }
  return loaded.get(area);
}

// Which water map covers both ends, by their boxes (cheap, before loading).
export const AREA_BOXES = {
  abacos: { south: 26.15, west: -77.7, north: 27.1, east: -76.8 },
  biscayne: { south: 25.55, west: -80.35, north: 25.92, east: -80.05 },
};
export function waterAreaFor(a, b) {
  return WATER_AREAS.find((k) => gridCovers(AREA_BOXES[k], a) && gridCovers(AREA_BOXES[k], b)) || null;
}

/** The app's boat route: { points, distanceMeters, minutes } or null. */
export async function findBoatRoute(a, b) {
  const area = waterAreaFor(a, b);
  if (!area) return null;
  const grid = await loadWaterGrid(area);
  return grid ? boatRouteOnGrid(grid, a, b) : null;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function heading(a, b) {
  const toRad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toRad) * Math.cos(b[0] * toRad);
  const x = Math.cos(a[0] * toRad) * Math.sin(b[0] * toRad) - Math.sin(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.cos((b[1] - a[1]) * toRad);
  const deg = (Math.atan2(y, x) / toRad + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * A boat route in the shape api/directions.js answers in, so the Map's
 * route panel and live navigation take it as they take a road route:
 * mode BOAT, one "Head <direction>" step per straight run.
 */
export function boatRouteData(route) {
  const pts = route.points;
  const steps = [];
  for (let k = 1; k < pts.length; k++) {
    const d = distanceMeters(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    if (d < 1) continue;
    const dir = heading(pts[k - 1], pts[k]);
    const prev = steps[steps.length - 1];
    // Runs in the same direction read as one step.
    if (prev && prev.dir === dir) {
      prev.distanceMeters += Math.round(d);
      prev.end = { lat: pts[k][0], lng: pts[k][1] };
      prev.durationSeconds = Math.round(prev.distanceMeters / BOAT_MPS);
      continue;
    }
    steps.push({ dir, instruction: `Head ${dir}`, distanceMeters: Math.round(d), durationSeconds: Math.round(d / BOAT_MPS), end: { lat: pts[k][0], lng: pts[k][1] }, maneuver: 'STRAIGHT' });
  }
  return {
    mode: 'BOAT',
    distanceMeters: route.distanceMeters,
    durationSeconds: route.minutes * 60,
    staticDurationSeconds: 0,
    points: pts,
    steps: steps.map(({ dir: _dir, ...s }) => s),
  };
}
