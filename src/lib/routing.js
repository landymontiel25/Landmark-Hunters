import { distanceMeters } from './geo';
import { API_BASE } from './apiBase';
import { fetchJson } from './friendlyError';

// Rough average speeds for a mixed walk/transit/drive city trip.
const WALK_SPEED_MPS = 1.3; // ~4.7 km/h
const DRIVE_SPEED_MPS = 8.3; // ~30 km/h incl. stops/parking

export function estimateTravelMinutes(meters) {
  const speed = meters > 1200 ? DRIVE_SPEED_MPS : WALK_SPEED_MPS;
  const seconds = meters / speed;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Nearest-neighbor route: starting at `origin` ({lat,lng}), repeatedly hop to the
 * closest not-yet-visited landmark. Returns landmarks in visit order, each annotated
 * with distanceFromPrevMeters and travelMinutesFromPrev.
 */
export function buildNearestNeighborRoute(origin, landmarks) {
  return annotateLegs(origin, improveTwoOpt(origin, nearestNeighborOrder(origin, landmarks)));
}

function annotateLegs(origin, ordered) {
  let prev = origin;
  return ordered.map((l) => {
    const d = distanceMeters(prev.lat, prev.lng, l.lat, l.lng);
    prev = l;
    return { ...l, distanceFromPrevMeters: Math.round(d), travelMinutesFromPrev: estimateTravelMinutes(d) };
  });
}

// Greedy: from wherever you are, go to the closest place you haven't been.
function nearestNeighborOrder(origin, landmarks) {
  const remaining = [...landmarks];
  const ordered = [];
  let current = origin;

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMeters(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = next;
  }

  return ordered;
}

// 2-opt: keep reversing any stretch of the path whose reversal shortens the
// total walk until nothing improves. Fixes the crossings a greedy chain
// leaves behind (the classic "back and forth across the island" route).
// Start point (you) stays fixed; the path is open-ended.
export function improveTwoOpt(origin, ordered) {
  const pts = [origin, ...ordered];
  const n = pts.length;
  if (n < 4) return ordered;
  const d = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const before = d(pts[i - 1], pts[i]) + (k + 1 < n ? d(pts[k], pts[k + 1]) : 0);
        const after = d(pts[i - 1], pts[k]) + (k + 1 < n ? d(pts[i], pts[k + 1]) : 0);
        if (after + 0.5 < before) {
          const seg = pts.slice(i, k + 1).reverse();
          pts.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return pts.slice(1);
}

/**
 * "Near Me" ordering: sort landmarks by straight-line distance from `origin`
 * (your current location), nearest first — so the top stop is always the one to
 * go to next. Each is annotated with distanceFromMeMeters + travelMinutesFromMe.
 */
export function buildNearestFirstList(origin, landmarks) {
  return landmarks
    .map((l) => {
      const d = Math.round(distanceMeters(origin.lat, origin.lng, l.lat, l.lng));
      return { ...l, distanceFromMeMeters: d, travelMinutesFromMe: estimateTravelMinutes(d) };
    })
    .sort((a, b) => a.distanceFromMeMeters - b.distanceFromMeMeters);
}

// The "Sort by" choices on an itinerary. Every one produces a visit order;
// annotateRoute then fills in the leg between each stop and the one before
// it, so the list, the totals, and the map route all follow whichever sort
// is picked -- the map's numbered pins always match the cards.
export const SORT_OPTIONS = [
  { id: 'nearest', label: 'Nearest to me' },
  { id: 'custom', label: 'My order' },
  { id: 'rated', label: 'Highest rated' },
  { id: 'quick', label: 'Quickest visits' },
  { id: 'free', label: 'Free first' },
];

// `customOrder`: landmark ids in the order the traveler dragged them into
// (see useDragReorder.js). Anything not in it (just added, or from before
// a custom order existed) falls in at the end, nearest-first among
// themselves, rather than vanishing from the list.
export function orderStops(sortId, origin, landmarks, ratings = {}, customOrder = []) {
  const dist = (l) => distanceMeters(origin.lat, origin.lng, l.lat, l.lng);
  const nearest = (a, b) => dist(a) - dist(b);
  const list = [...landmarks];
  switch (sortId) {
    // "Nearest to me" is a walkable chain (closest first, then closest to
    // *that*, untangled with 2-opt) -- not a plain sort by distance from
    // you, which zig-zags past places you'll have to come back for.
    case 'nearest':
    case 'route':
      return buildNearestNeighborRoute(origin, landmarks);
    case 'custom': {
      const byId = new Map(list.map((l) => [l.id, l]));
      const ordered = customOrder.map((id) => byId.get(id)).filter(Boolean);
      const placed = new Set(ordered.map((l) => l.id));
      const rest = list.filter((l) => !placed.has(l.id)).sort(nearest);
      return [...ordered, ...rest];
    }
    case 'rated': {
      const r = (l) => ratings[l.id] || { avg: 0, count: 0 };
      // Rated places first (by average, then by how many rated it); the
      // unrated ones keep nearest-first among themselves at the end.
      return list.sort((a, b) => {
        const ra = r(a);
        const rb = r(b);
        if (!!ra.count !== !!rb.count) return ra.count ? -1 : 1;
        if (rb.avg !== ra.avg) return rb.avg - ra.avg;
        if (rb.count !== ra.count) return rb.count - ra.count;
        return nearest(a, b);
      });
    }
    case 'quick':
      return list.sort((a, b) => (a.typicalMinutes || 0) - (b.typicalMinutes || 0) || nearest(a, b));
    case 'free':
      return list.sort((a, b) => (a.free === b.free ? nearest(a, b) : a.free ? -1 : 1));
    default:
      return list.sort(nearest);
  }
}

// Leg distance/time from the previous stop (or from `origin` for the first),
// for stops in a given visit order.
export function annotateRoute(origin, ordered) {
  let prev = origin;
  return ordered.map((l) => {
    const d = Math.round(distanceMeters(prev.lat, prev.lng, l.lat, l.lng));
    prev = l;
    return { ...l, distanceFromPrevMeters: d, travelMinutesFromPrev: estimateTravelMinutes(d) };
  });
}

const OSRM_DRIVING_BASE = 'https://router.project-osrm.org/route/v1/driving';

/**
 * Real road-based driving distance/duration between two points, via the free public
 * OSRM demo server (no API key). Returns null on any failure so callers can fall back
 * to the straight-line estimate.
 */
export async function fetchDrivingRoute(origin, dest) {
  try {
    const url = `${OSRM_DRIVING_BASE}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const leg = data?.routes?.[0];
    if (!leg) return null;
    return { distanceMeters: Math.round(leg.distance), durationSeconds: leg.duration };
  } catch {
    return null;
  }
}

/**
 * Replaces each drive-length leg's straight-line estimate with a real road-based
 * distance/duration from OSRM. Walking-length legs keep the straight-line estimate
 * (the free OSRM demo only reliably serves driving routes). Legs where OSRM fails
 * (offline, rate-limited) silently keep their straight-line estimate too.
 */
export async function enhanceRouteWithDrivingTimes(origin, route) {
  return Promise.all(
    route.map(async (stop, idx) => {
      if (stop.distanceFromPrevMeters <= 1200) return stop;
      const prev = idx === 0 ? origin : route[idx - 1];
      const real = await fetchDrivingRoute(prev, stop);
      if (!real) return stop;
      return {
        ...stop,
        distanceFromPrevMeters: real.distanceMeters,
        travelMinutesFromPrev: Math.max(1, Math.round(real.durationSeconds / 60)),
      };
    })
  );
}

/**
 * Turn-by-turn directions from the Routes API via api/directions.js:
 * { mode, distanceMeters, durationSeconds, staticDurationSeconds,
 *   points: [[lat, lng], ...], steps: [{ instruction, distanceMeters, durationSeconds }] }.
 * Throws with the server's message on failure.
 */
export async function fetchDirections(origin, destination) {
  const data = await fetchJson(`${API_BASE}/api/directions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
    }),
  });
  if (!data?.points?.length) throw Object.assign(new Error('No route'), { userMessage: 'Could not get directions right now.' });
  return data;
}

export function appleMapsLink(destination, destLat, destLng) {
  const dest = destLat != null && destLng != null ? `${destLat},${destLng}` : encodeURIComponent(destination);
  return `https://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(destination)}`;
}

export function googleMapsLink(destination, destLat, destLng) {
  const dest = destLat != null && destLng != null ? `${destLat},${destLng}` : encodeURIComponent(destination);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

export function mapsDeepLink(destination, destLat, destLng) {
  const dest = destLat != null && destLng != null ? `${destLat},${destLng}` : encodeURIComponent(destination);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    return `https://maps.apple.com/?daddr=${dest}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

// Google Maps with every stop in order (Apple Maps' web links can't take
// more than one destination). Google allows up to 9 waypoints between
// origin and destination; with no origin it starts from your location.
// Only the first 10 stops fit one link -- use googleMapsMultiStopLegs for more.
export const MAPS_STOPS_PER_LINK = 10;
export function googleMapsMultiStopLink(stops, origin, mode = 'driving') {
  const pt = (s) => `${s.lat},${s.lng}`;
  const list = stops.slice(0, MAPS_STOPS_PER_LINK);
  if (!list.length) return null;
  const params = new URLSearchParams({ api: '1', destination: pt(list[list.length - 1]), travelmode: mode });
  if (origin) params.set('origin', pt(origin));
  if (list.length > 1) params.set('waypoints', list.slice(0, -1).map(pt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Every stop, split into consecutive links of up to 10 stops. Each part
// starts where the previous one ended, so nothing is dropped.
export function googleMapsMultiStopLegs(stops, origin, mode = 'driving') {
  const links = [];
  let from = origin;
  for (let i = 0; i < stops.length; i += MAPS_STOPS_PER_LINK) {
    const chunk = stops.slice(i, i + MAPS_STOPS_PER_LINK);
    links.push(googleMapsMultiStopLink(chunk, from, mode));
    from = chunk[chunk.length - 1];
  }
  return links;
}
