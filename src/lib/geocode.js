import { reverseGeocodePlace } from './placeLookup';
import { distanceMeters } from './geo';

/**
 * Free-tier geocoding via OpenStreetMap Nominatim (no API key required).
 * Biases results to the trip's region using a viewbox for accuracy.
 * (Live address-search-as-you-type has since moved to Google Places API --
 * see src/lib/places.js -- this file still backs reverse country lookup and
 * the Itinerary starting-location geocode.)
 */
/**
 * Which country a GPS fix is in, as an ISO 3166-1 alpha-2 code ("US", "IT").
 * Nominatim reverse lookup at country zoom -- one call per session, for the
 * automatic imperial/metric choice. Null on any failure; never throws.
 */
export async function reverseCountryCode(lat, lng) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'json', zoom: '3' });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const code = data?.address?.country_code;
    return code ? code.toUpperCase() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// A business only names your spot when it's this close to you; otherwise a
// shop across the street would label your front door.
const BUSINESS_MATCH_METERS = 25;

/**
 * The street address (or the business you're standing in) for a GPS fix:
 * "Dunkin', 9 Station Rd, Ardmore, PA 19003, USA" or "9 Station Road,
 * Ardmore, Pennsylvania". Google Places names the business; Nominatim at
 * building zoom gives the street address. Null on any failure; never throws.
 */
export async function reverseAddress(lat, lng) {
  const place = await reverseGeocodePlace(lat, lng);
  if (place?.name && distanceMeters(lat, lng, place.lat, place.lng) <= BUSINESS_MATCH_METERS) {
    if (!place.address) return place.name;
    return place.address.startsWith(place.name) ? place.address : `${place.name}, ${place.address}`;
  }
  return streetAddress(lat, lng);
}

const STREET_CACHE_KEY = 'lh-street-address-cache';
function readStreetCache() {
  try {
    return JSON.parse(localStorage.getItem(STREET_CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const streetKey = (lat, lng) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/** The cached street address for a point, if this device has looked it up before. */
export function cachedStreetAddress(lat, lng) {
  return readStreetCache()[streetKey(lat, lng)] || null;
}

/**
 * Street address for a point via Nominatim at building zoom: "Independence
 * Hall, 520 Chestnut Street, Philadelphia, Pennsylvania". Cached on this
 * device (addresses don't move). Null on any failure; never throws.
 */
// Nominatim allows one request a second per app. Callers that restart their
// loop (a list that re-sorts) used to fire overlapping lookups, so the spacing
// and de-duplication live here: one shared queue, one request per point in
// flight, and a point that just failed isn't asked again for 10 minutes.
const STREET_GAP_MS = 1100;
const STREET_MISS_MS = 10 * 60 * 1000;
const streetInFlight = new Map();
const streetMisses = new Map();
let streetQueue = Promise.resolve();
let streetLastAt = 0;

export function streetAddress(lat, lng) {
  const key = streetKey(lat, lng);
  const cached = readStreetCache()[key];
  if (cached) return Promise.resolve(cached);
  if (Date.now() - (streetMisses.get(key) || 0) < STREET_MISS_MS) return Promise.resolve(null);
  if (streetInFlight.has(key)) return streetInFlight.get(key);
  const run = streetQueue.then(async () => {
    const wait = streetLastAt + STREET_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    streetLastAt = Date.now();
    const label = await lookupStreetAddress(lat, lng, key);
    // Offline isn't a miss: try again as soon as the connection is back.
    if (!label && !(typeof navigator !== 'undefined' && navigator.onLine === false)) streetMisses.set(key, Date.now());
    return label;
  });
  streetQueue = run.catch(() => null);
  const p = run.finally(() => streetInFlight.delete(key));
  streetInFlight.set(key, p);
  return p;
}

async function lookupStreetAddress(lat, lng, key) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'json', zoom: '18', addressdetails: '1' });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const a = (await res.json())?.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const building = a.building || a.amenity || a.shop || a.tourism || null;
    const town = a.city || a.town || a.village || a.suburb || a.hamlet;
    const label = [building, street, town, a.state].filter(Boolean).join(', ') || null;
    if (label) {
      try {
        localStorage.setItem(STREET_CACHE_KEY, JSON.stringify({ ...readStreetCache(), [key]: label }));
      } catch {
        /* storage full -- still return it */
      }
    }
    return label;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function geocodeLocation(text, region) {
  if (!text || !text.trim()) return null;

  const params = new URLSearchParams({
    q: text,
    format: 'json',
    limit: '1',
  });

  if (region?.viewbox) {
    const { minLat, minLng, maxLat, maxLng } = region.viewbox;
    params.set('viewbox', `${minLng},${maxLat},${maxLng},${minLat}`);
    params.set('bounded', '1');
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results?.length) return region?.center ?? null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return region?.center ?? null;
  }
}

// "Radnor, Pennsylvania, United States" for a GPS fix -- the town Mapr is
// told the traveler is in. Cached per ~1 km so a moving phone doesn't hit
// Nominatim on every message. Null on any failure; never throws.
const localityCache = new Map();
export async function reverseLocality(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (localityCache.has(key)) return localityCache.get(key);
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'json', zoom: '14' });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const a = (await res.json())?.address || {};
    const town = a.neighbourhood || a.suburb || a.village || a.town || a.city || a.hamlet || a.county;
    const city = a.city && a.city !== town ? a.city : null;
    const label = [town, city, a.state, a.country].filter(Boolean).join(', ') || null;
    localityCache.set(key, label);
    return label;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
