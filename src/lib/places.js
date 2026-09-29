import { API_BASE } from './apiBase';
/**
 * Address search for Add Landmark / Trip Setup, backed by Google Places API
 * (New) via the /api/places-* server functions -- keeps GOOGLE_PLACES_API_KEY
 * server-only. Two calls, matching Google's Autocomplete + Place Details
 * session pattern: searchPlaces() for the live dropdown (no coordinates),
 * then getPlaceDetails() once, when a suggestion is actually picked.
 */

/** A fresh per-session id, billed by Google as one Autocomplete+Details session. */
export function makeSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Live-typing address/place suggestions, biased to the trip's region.
 * Returns [{ placeId, primary, secondary }] -- no lat/lng yet, resolve the
 * picked one with getPlaceDetails().
 */
export async function searchPlaces(text, region, sessionToken) {
  if (!text || text.trim().length < 2) return [];

  const body = { input: text.trim(), sessionToken };
  if (region?.viewbox) body.viewbox = region.viewbox;

  // No catch here -- a genuinely failed search (network error, quota,
  // a non-2xx response) needs to reach the caller as an error, not come
  // back silently as "zero matches."
  const res = await fetch(`${API_BASE}/api/places-autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Address search failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

/**
 * Resolves a suggestion's placeId into { primary, secondary, lat, lng }
 * (Essentials tier only -- name, address, coordinates).
 */
export async function getPlaceDetails(placeId, sessionToken) {
  const params = new URLSearchParams({ placeId });
  if (sessionToken) params.set('sessionToken', sessionToken);
  const res = await fetch(`${API_BASE}/api/places-details?${params.toString()}`);
  if (!res.ok) throw new Error(`Could not look up that address: HTTP ${res.status}`);
  return res.json();
}
