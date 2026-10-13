import { timeoutSignal } from './upstream.js';

// Mapr chat's route_between tool (api/plan-ai.js): the REAL distance and
// travel time between two places, so Mapr never guesses one. Each place is
// found in the app's own catalog first, then with Google Places text search
// (biased to where the traveler is); the route comes from Google's Routes
// API (driving with live traffic, or walking). Any failure comes back as an
// error the model has to own up to, never a made-up number.

const ME = /^(me|my location|my current location|current location|here|where i am|where i'm at|my spot)$/i;
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const km = (a, b) => {
  const R = 6371;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// A catalog place by name: an exact name first, then a name that contains
// the query (or the other way round), nearest to the traveler on ties.
export function findInCatalog(query, catalog = [], near = null) {
  const q = norm(query);
  if (q.length < 3) return null;
  const hits = catalog.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  const exact = hits.filter((l) => norm(l.name) === q);
  const loose = exact.length ? exact : hits.filter((l) => {
    const n = norm(l.name);
    return n.length >= 4 && (n.includes(q) || q.includes(n));
  });
  if (!loose.length) return null;
  const best = near ? [...loose].sort((a, b) => km(near, a) - km(near, b))[0] : loose[0];
  return { name: best.name, lat: best.lat, lng: best.lng, address: best.address || '', source: 'catalog' };
}

async function googlePlace(query, near, fetchImpl) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({
      textQuery: String(query).slice(0, 200),
      maxResultCount: 1,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
    }),
  });
  if (!r.ok) return null;
  const p = (await r.json())?.places?.[0];
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name: p.displayName?.text || query, lat, lng, address: p.formattedAddress || '', source: 'google' };
}

export async function resolvePlace(query, { catalog = [], near = null, fetchImpl = fetch } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (ME.test(q)) return near ? { name: 'your location', lat: near.lat, lng: near.lng, address: '', source: 'gps' } : null;
  return findInCatalog(q, catalog, near) || (await googlePlace(q, near, fetchImpl));
}

export async function routeBetween({ from, to, mode = 'drive' } = {}, { catalog = [], near = null, fetchImpl = fetch } = {}) {
  const [a, b] = await Promise.all([resolvePlace(from, { catalog, near, fetchImpl }), resolvePlace(to, { catalog, near, fetchImpl })]);
  if (!a) return { error: ME.test(String(from || '').trim()) ? "The traveler's location isn't available." : `Couldn't find "${from}".` };
  if (!b) return { error: ME.test(String(to || '').trim()) ? "The traveler's location isn't available." : `Couldn't find "${to}".` };
  if (!process.env.GOOGLE_ROUTES_API_KEY) return { error: 'Route lookup is not set up.' };
  const travelMode = mode === 'walk' ? 'WALK' : 'DRIVE';
  const r = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode,
      ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  });
  if (!r.ok) return { error: 'The route lookup failed.' };
  const route = (await r.json())?.routes?.[0];
  const meters = Number(route?.distanceMeters);
  const seconds = parseInt(route?.duration, 10);
  if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return { error: 'No route found between those places.' };
  const noTraffic = parseInt(route?.staticDuration, 10);
  return {
    from: { name: a.name, address: a.address },
    to: { name: b.name, address: b.address },
    mode: travelMode === 'WALK' ? 'walking' : 'driving',
    miles: Math.round((meters / 1609.34) * 10) / 10,
    km: Math.round((meters / 1000) * 10) / 10,
    minutes: Math.max(1, Math.round(seconds / 60)),
    ...(travelMode === 'DRIVE' && Number.isFinite(noTraffic) ? { minutesWithoutTraffic: Math.max(1, Math.round(noTraffic / 60)) } : {}),
    source: 'Google Maps',
  };
}

// "How far / how long / how many minutes" questions: Mapr must look the
// route up before answering (plan-ai forces the tool for these).
export const asksDistanceOrTime = (text) =>
  /\b(how (far|long|close|many (minutes|mins|miles|hours|km|kilometers))|distance|(minutes?|mins?|miles?|hours?|km) (away|from|to|drive|walk)|drive time|travel time|walking time|get there|eta)\b/i.test(String(text || ''));
