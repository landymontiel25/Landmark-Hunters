import { distanceMeters } from './geo';
import { isIslandPlace } from './islands';

// How you're getting around an itinerary (owner, 2026-11-23), like Google
// Maps asks. Only the ways that fit the trip are offered:
//   Walk  only when every leg is a walk (3 km or less)
//   Bike  legs up to 20 km
//   Drive anything on the road network (always)
//   Bus   anywhere but an island-only trip (city buses, or an intercity
//         bus on a long trip like Miami to Key West)
//   Boat  only in the islands (a stop on an island: the Abacos' cays, Key
//         Biscayne), never in a city like Brickell
//   Fly   a long trip (a leg of 150 km or more)
// The choice sets every leg's time and the Google Maps links.

export const TRAVEL_MODES = [
  { id: 'walk', label: 'Walk', verb: 'walk', google: 'walking' },
  { id: 'car', label: 'Drive', verb: 'drive', google: 'driving' },
  { id: 'bus', label: 'Bus', verb: 'by bus', google: 'transit' },
  { id: 'bike', label: 'Bike', verb: 'bike ride', google: 'bicycling' },
  { id: 'boat', label: 'Boat', verb: 'by boat', google: null },
  { id: 'plane', label: 'Fly', verb: 'flight', google: null },
];
export const travelMode = (id) => TRAVEL_MODES.find((m) => m.id === id) || TRAVEL_MODES[1];

const WALK_MAX_M = 3000;
const BIKE_MAX_M = 20000;
const FLY_MIN_M = 150000;
// Straight-line meters to minutes: a detour factor for the real path, a
// speed, and a fixed wait (parking, a bus stop, a dock, an airport).
const PACE = {
  walk: { detour: 1.25, mps: 1.35, wait: 0 },
  bike: { detour: 1.25, mps: 4.2, wait: 1 },
  car: { detour: 1.3, mps: 12, wait: 2 },
  bus: { detour: 1.35, mps: 6.5, wait: 8 },
  boat: { detour: 1.15, mps: 9, wait: 5 },
  plane: { detour: 1.05, mps: 190, wait: 90 },
};

export function legMinutes(meters, mode) {
  const p = PACE[mode] || PACE.car;
  return Math.max(1, Math.round((meters * p.detour) / p.mps / 60 + p.wait));
}

// Every leg's straight-line length, from `origin` (if any) through the stops.
export function legLengths(origin, stops) {
  const pts = [...(origin ? [origin] : []), ...stops].filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push(distanceMeters(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng));
  return out;
}

// { modes: [ids], suggested: id } for this trip.
export function travelModesFor({ origin = null, stops = [] }) {
  const legs = legLengths(origin, stops);
  const longest = legs.length ? Math.max(...legs) : 0;
  const island = stops.some(isIslandPlace);
  const allIsland = stops.length > 0 && stops.every(isIslandPlace);
  const modes = [];
  if (longest <= WALK_MAX_M) modes.push('walk');
  modes.push('car');
  if (!allIsland) modes.push('bus');
  if (longest <= BIKE_MAX_M) modes.push('bike');
  if (island) modes.push('boat');
  if (longest >= FLY_MIN_M) modes.push('plane');
  let suggested = 'car';
  if (longest <= 1200) suggested = 'walk';
  else if (allIsland && longest > WALK_MAX_M) suggested = 'boat';
  return { modes, suggested };
}

// The mode to use: the traveler's pick when it fits this trip, else the
// suggestion.
export function effectiveMode(picked, { modes, suggested }) {
  return picked && modes.includes(picked) ? picked : suggested;
}

// "12 min by boat", for a leg.
export function legLabel(minutes, mode) {
  const m = travelMode(mode);
  const t = minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  return `${t} ${m.verb}`;
}

// The way you last picked to get around (Get directions, an itinerary),
// so Mapr talks about the trip the way you're actually making it (owner,
// 2026-11-23: on a boat, boat times, never driving). Kept 12 hours.
const LAST_MODE_KEY = 'lh-travel-mode';
const LAST_MODE_MS = 12 * 60 * 60 * 1000;
export function rememberTravelMode(mode) {
  if (!TRAVEL_MODES.some((m) => m.id === mode)) return;
  try {
    localStorage.setItem(LAST_MODE_KEY, JSON.stringify({ mode, t: Date.now() }));
  } catch {
    /* private mode */
  }
}
export function recentTravelMode(now = Date.now()) {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_MODE_KEY) || 'null');
    return v && TRAVEL_MODES.some((m) => m.id === v.mode) && now - (v.t || 0) < LAST_MODE_MS ? v.mode : null;
  } catch {
    return null;
  }
}
