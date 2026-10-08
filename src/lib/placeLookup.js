import { searchPlaces, getPlaceDetails, makeSessionToken } from './places';
import { REGIONS } from '../data/regions';
import { distanceMeters } from './geo';
import { API_BASE } from './apiBase';

/**
 * Finds a real place by text ("Autana, 9 Station Rd, Ardmore") and returns
 * { lat, lng, address } via Google Places, biased toward `near` (the
 * traveler's location) when given. Throws when nothing matches.
 */
export async function lookupPlace(query, near) {
  const viewbox = near
    ? { minLat: near.lat - 0.4, maxLat: near.lat + 0.4, minLng: near.lng - 0.5, maxLng: near.lng + 0.5 }
    : null;
  const token = makeSessionToken();
  const [top] = await searchPlaces(query, viewbox ? { viewbox } : null, token);
  if (!top) throw new Error('No match');
  const d = await getPlaceDetails(top.placeId, token);
  if (!Number.isFinite(d?.lat) || !Number.isFinite(d?.lng)) throw new Error('No coordinates');
  return { lat: d.lat, lng: d.lng, address: d.secondary || d.primary || '' };
}

/**
 * The app city a point belongs to (nearest region center), or null when
 * it's farther than maxKm from every city the app tracks.
 */
export function nearestRegionId(lat, lng, maxKm = 120) {
  let best = null;
  for (const r of REGIONS) {
    if (!r.center) continue;
    if (r.worldwide) continue; // a catalog like Formula 1 Circuits, not a place
    const d = distanceMeters(lat, lng, r.center.lat, r.center.lng);
    if (d <= maxKm * 1000 && (!best || d < best.d)) best = { id: r.id, d };
  }
  return best?.id ?? null;
}

/**
 * Names the business at a GPS point (via /api/places-nearby), for the habit
 * prompt (src/lib/habitTracking.js) -- a repeated visit is just coordinates
 * until this says what's actually there. Returns null rather than throwing
 * when nothing's found or the lookup fails, since the caller just leaves
 * the cluster unnamed and tries again later.
 */
export async function reverseGeocodePlace(lat, lng) {
  // A hung request would keep the caller from ever falling back.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${API_BASE}/api/places-nearby`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.name) return null;
    return { name: data.name, address: data.address || '', lat: data.lat ?? lat, lng: data.lng ?? lng, placeId: data.placeId || '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Stable id for a web place, so adding the same spot twice doesn't duplicate it.
export function placeId(name, lat, lng) {
  const slug = String(name || 'place')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);
  return `place-${slug}-${lat.toFixed(4)}-${lng.toFixed(4)}`;
}
