import { guardBilledRequest } from './_lib/billedGuard.js';
import { withCors } from './_lib/cors.js';
import { travelDistances, TRAVEL_MODES } from './_lib/travelDistance.js';

// The distance a landmark card shows (owner, 2026-11-23): the real travel
// distance by the way the traveler is going, never the straight line when
// a route exists, and the same number Mapr and the route panel give
// (api/_lib/travelDistance.js).
//   POST { origin: { lat, lng }, mode, places: [{ id, lat, lng }] }  (25 max)
//   -> { mode, distances: { [id]: { meters, seconds } | null } }
// Boat is worked out on the app's own water maps (free); the other modes
// are one Google route matrix call, behind the billed-request guard and a
// daily cap (usageQuota.js 'route-distances'). Answers are kept for an
// hour per instance, by origin rounded to ~200 m, so a list scrolled again
// costs nothing.

const MAX_PLACES = 25;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // key -> { at, cell }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const point = (p) => {
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = req.body || {};
  const origin = point(body.origin);
  const mode = TRAVEL_MODES.includes(body.mode) ? body.mode : null;
  const places = (Array.isArray(body.places) ? body.places : [])
    .slice(0, MAX_PLACES)
    .map((p) => ({ id: typeof p?.id === 'string' && p.id.length <= 200 ? p.id : null, ...point(p) }))
    .filter((p) => p.id && Number.isFinite(p.lat));
  if (!origin || !mode || !places.length) {
    res.status(400).json({ error: 'origin, mode and places are required.' });
    return;
  }
  const o = { lat: Math.round(origin.lat * 500) / 500, lng: Math.round(origin.lng * 500) / 500 };
  const key = (p) => `${mode}|${o.lat},${o.lng}|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const now = Date.now();
  const distances = {};
  const todo = [];
  for (const p of places) {
    const hit = cache.get(key(p));
    if (hit && now - hit.at < CACHE_MS) distances[p.id] = hit.cell;
    else todo.push(p);
  }
  if (todo.length) {
    // Boat costs nothing (the app's own maps); everything else is billed.
    if (mode !== 'boat' && !(await guardBilledRequest(req, res, { key: 'travel-distances', scope: 'route-distances', what: 'Distance', limit: 60, anonLimit: 20, windowMs: 10 * 60 * 1000 }))) return;
    try {
      const cells = await travelDistances(origin, todo, mode);
      todo.forEach((p, i) => {
        distances[p.id] = cells[i] || null;
        cache.set(key(p), { at: now, cell: cells[i] || null });
      });
    } catch {
      res.status(502).json({ error: 'Could not look up distances right now.' });
      return;
    }
    if (cache.size > 20000) cache.clear();
  }
  res.status(200).json({ mode, distances });
}

export default withCors(handler);
