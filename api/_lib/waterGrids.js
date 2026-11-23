import { decodeGrid, gridCovers, waterAreaFor, boatRouteOnGrid, AREA_BOXES, WATER_AREAS } from '../../src/lib/boatRoute.js';
import abacos from './water/abacos.js';
import biscayne from './water/biscayne.js';

// The water maps on the server, for Mapr's boat times: the same grids and
// the same route finder the app draws with (src/lib/boatRoute.js), so Mapr
// and the Map give the same boat route. Bundled with the functions
// (api/_lib/water/, written by scripts/water-grid/build-water-grid.mjs):
// fetching the site's own /water/ file from a function failed live, and
// Mapr said no boat route was available (2026-11-23).
const RAW = { abacos, biscayne };
const grids = new Map(); // area -> decoded grid

export function serverGrid(area) {
  if (!grids.has(area) && RAW[area]) grids.set(area, decodeGrid(RAW[area]));
  return grids.get(area) || null;
}

/** A boat route between two points, or null (outside the maps, or no water path). */
export async function serverBoatRoute(a, b) {
  const area = waterAreaFor(a, b);
  const grid = area ? serverGrid(area) : null;
  return grid ? boatRouteOnGrid(grid, a, b) : null;
}

/** Whether a point is out on the water (a traveler on a boat). */
export async function onWater(p) {
  const area = WATER_AREAS.find((k) => gridCovers(AREA_BOXES[k], p));
  const g = area ? serverGrid(area) : null;
  if (!g) return false;
  const r = Math.floor((g.north - p.lat) / g.dLat);
  const c = Math.floor((p.lng - g.west) / g.dLng);
  return !!g.water[r * g.cols + c];
}
