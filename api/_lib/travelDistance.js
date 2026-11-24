import { timeoutSignal } from './upstream.js';
import { serverBoatRoute } from './waterGrids.js';
import { boatMinutes } from '../../src/lib/boatRoute.js';

// How far and how long, by the way the traveler is going (owner,
// 2026-11-23: "the distance and time shown for a route, a card and a Mapr
// answer are always the same number, measured the same way"). One source
// for all three: the cards (api/travel-distances.js), Mapr's route_between
// and best_order (routeLookup.js).
//   boat           the app's boat route around the islands (boatRoute.js)
//   walk/car/bike/bus  Google's route matrix in that mode
// Each answer is { meters, seconds } or null when there's no such route.

export const MATRIX_MODES = { car: 'DRIVE', walk: 'WALK', bike: 'BICYCLE', bus: 'TRANSIT' };
export const TRAVEL_MODES = ['car', 'walk', 'bike', 'bus', 'boat'];

// Many origins to many destinations ({ lat, lng }); out[i][j].
export async function travelMatrix(origins, dests, mode, { fetchImpl = fetch, boatRoute = serverBoatRoute } = {}) {
  const out = origins.map(() => dests.map(() => null));
  if (mode === 'boat') {
    for (let i = 0; i < origins.length; i++) {
      for (let j = 0; j < dests.length; j++) {
        const r = await boatRoute(origins[i], dests[j]);
        if (r) out[i][j] = { meters: r.distanceMeters, seconds: r.minutes * 60 };
      }
    }
    return out;
  }
  const travelMode = MATRIX_MODES[mode] || 'DRIVE';
  if (!process.env.GOOGLE_ROUTES_API_KEY) return out;
  const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  const r = await fetchImpl('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition' },
    body: JSON.stringify({
      origins: origins.map(wp),
      destinations: dests.map(wp),
      travelMode,
      ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  });
  if (!r.ok) throw Object.assign(new Error('route matrix failed'), { status: r.status });
  const rows = await r.json();
  for (const e of Array.isArray(rows) ? rows : []) {
    if (e.condition && e.condition !== 'ROUTE_EXISTS') continue;
    const seconds = parseInt(e.duration, 10);
    const meters = Number(e.distanceMeters);
    if (Number.isFinite(seconds) && Number.isFinite(meters) && out[e.originIndex]) out[e.originIndex][e.destinationIndex] = { meters, seconds };
  }
  return out;
}

/** From one place to each of several: [{ meters, seconds } | null]. */
export async function travelDistances(origin, dests, mode, opts) {
  return (await travelMatrix([origin], dests, mode, opts))[0];
}

export const minutesOf = (cell) => Math.max(1, Math.round(cell.seconds / 60));
export { boatMinutes };
