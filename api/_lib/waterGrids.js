import { decodeGrid, gridCovers, waterAreaFor, boatRouteOnGrid, AREA_BOXES, WATER_AREAS } from '../../src/lib/boatRoute.js';
import { timeoutSignal } from './upstream.js';

// The water maps (public/water/<area>.json) on the server, for Mapr's boat
// times: the same grids and the same route finder the app draws with
// (src/lib/boatRoute.js), so Mapr and the Map give the same boat route.
// Read from the site itself once per server instance.
const SITE = process.env.PUBLIC_SITE_URL || 'https://landmarkhunters.com';
const grids = new Map(); // area -> Promise<grid | null>

export function loadServerGrid(area, fetchImpl = fetch) {
  if (!grids.has(area)) {
    const p = fetchImpl(`${SITE}/water/${area}.json`, { signal: timeoutSignal() })
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => (g ? decodeGrid(g) : null))
      .catch(() => null);
    grids.set(area, p);
    p.then((g) => !g && grids.delete(area));
  }
  return grids.get(area);
}

/** A boat route between two points, or null (outside the maps, or no water path). */
export async function serverBoatRoute(a, b, fetchImpl = fetch) {
  const area = waterAreaFor(a, b);
  if (!area) return null;
  const grid = await loadServerGrid(area, fetchImpl);
  return grid ? boatRouteOnGrid(grid, a, b) : null;
}

/** Whether a point is out on the water (a traveler on a boat). */
export async function onWater(p, fetchImpl = fetch) {
  const area = WATER_AREAS.find((k) => gridCovers(AREA_BOXES[k], p));
  if (!area) return false;
  const g = await loadServerGrid(area, fetchImpl);
  if (!g) return false;
  const r = Math.floor((g.north - p.lat) / g.dLat);
  const c = Math.floor((p.lng - g.west) / g.dLng);
  return !!g.water[r * g.cols + c];
}
