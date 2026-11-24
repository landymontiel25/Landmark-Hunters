import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';
import { recentTravelMode } from './travelModes';
import { AREA_BOXES, WATER_AREAS, gridCovers, loadWaterGrid, findBoatRoute } from './boatRoute';

// The distance a landmark card shows (owner, 2026-11-23): the real travel
// distance by the way you're going, never the straight line when a route
// exists, the same number Mapr and the route panel give. One source for
// all of them: api/travel-distances.js (and api/_lib/travelDistance.js).
//   mode: your last pick in the app; else Boat when you're out on the
//         water; else Drive. Mapr gets the same mode (cardTravelMode).
//   Boat is worked out here on the water maps (free); the rest is asked
//   for in batches of up to 25, kept for this session.

const ROUND = 500; // origin rounded to ~200 m, like the server
const cache = new Map(); // key -> { value } | { promise }
const pending = new Map(); // batch key -> [{ place, resolve }]
let timer = null;

const roundPt = (p) => ({ lat: Math.round(p.lat * ROUND) / ROUND, lng: Math.round(p.lng * ROUND) / ROUND });
const keyOf = (mode, o, p) => `${mode}|${o.lat},${o.lng}|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** Whether a point is out on the water (the water maps). */
export async function onWater(p) {
  if (!p || !Number.isFinite(p.lat)) return false;
  const area = WATER_AREAS.find((k) => gridCovers(AREA_BOXES[k], p));
  if (!area) return false;
  const g = await loadWaterGrid(area);
  if (!g) return false;
  return !!g.water[Math.floor((g.north - p.lat) / g.dLat) * g.cols + Math.floor((p.lng - g.west) / g.dLng)];
}

/** The mode cards measure by, and Mapr is told: your pick, else boat on the water, else car. */
export async function cardTravelMode(origin) {
  return recentTravelMode() || ((await onWater(origin)) ? 'boat' : 'car');
}

async function flush() {
  timer = null;
  const batches = [...pending.entries()];
  pending.clear();
  for (const [bk, items] of batches) {
    const [mode, o] = [bk.split('|')[0], JSON.parse(bk.split('|')[1])];
    if (mode === 'boat') {
      for (const it of items) {
        const r = await findBoatRoute(o.exact, it.place).catch(() => null);
        it.resolve(r ? { meters: r.distanceMeters, seconds: r.minutes * 60 } : null);
        // Let the page breathe between routes.
        await new Promise((res) => setTimeout(res, 0));
      }
      continue;
    }
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      try {
        const r = await fetch(`${API_BASE}/api/travel-distances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ origin: o.exact, mode, places: chunk.map((it, k) => ({ id: String(k), lat: it.place.lat, lng: it.place.lng })) }),
        });
        const data = r.ok ? await r.json() : null;
        chunk.forEach((it, k) => it.resolve(data ? data.distances?.[String(k)] ?? null : undefined));
      } catch {
        chunk.forEach((it) => it.resolve(undefined));
      }
    }
  }
}

/**
 * { meters, seconds } by `mode` from `origin` to `place`; null when there is
 * no such route; undefined when it couldn't be looked up (try again later).
 */
export function travelDistance(origin, place, mode) {
  if (!origin || !place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) || !mode) return Promise.resolve(undefined);
  const o = roundPt(origin);
  const key = keyOf(mode, o, place);
  const hit = cache.get(key);
  if (hit) return 'value' in hit ? Promise.resolve(hit.value) : hit.promise;
  const promise = new Promise((resolve) => {
    const bk = `${mode}|${JSON.stringify({ ...o, exact: { lat: origin.lat, lng: origin.lng } })}`;
    if (!pending.has(bk)) pending.set(bk, []);
    pending.get(bk).push({ place, resolve });
    if (!timer) timer = setTimeout(flush, 120);
  }).then((value) => {
    if (value === undefined) cache.delete(key);
    else cache.set(key, { value });
    return value;
  });
  cache.set(key, { promise });
  return promise;
}
