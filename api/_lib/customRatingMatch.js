import { timeoutSignal } from './upstream.js';
import { classifyMatch } from './ratingMatch.js';
import { RATINGS_TIMEOUT_MS } from './ratingSources.js';

// Google ratings for landmarks users add (custom_landmarks). The hand-picked
// and imported places get their Google IDs from a script
// (src/data/ratingSourceIds.json); a user-added one gets its ID here, the
// first time anyone asks for its ratings: one Google Text Search, the same
// strict match the script uses (ratingMatch.js classifyMatch), and only the
// place ID is saved on the landmark's doc (the one thing Google lets us
// keep). No sure match: the attempt is noted and tried again after
// RETRY_MS, since a new business can show up on Google later.

export const CUSTOM_ID_PREFIX = 'custom-';
export const RETRY_MS = 14 * 24 * 60 * 60 * 1000;

export async function searchGoogleText(l, { apiKey = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('google: no key');
  const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal: timeoutSignal(RATINGS_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
    },
    body: JSON.stringify({
      textQuery: l.name,
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: l.lat, longitude: l.lng }, radius: 250 } },
    }),
  });
  if (!r.ok) throw new Error(`google search ${r.status}`);
  const data = await r.json();
  return (data.places || []).map((p) => ({ id: p.id, name: p.displayName?.text, lat: p.location?.latitude, lng: p.location?.longitude }));
}

/**
 * The Google place ID for a user-added landmark, or null when Google has no
 * sure match. Throws when the lookup itself failed (so the app doesn't say
 * "No ratings available" because Google was down).
 */
export async function customGooglePlaceId(db, id, { now = Date.now(), search = searchGoogleText } = {}) {
  if (typeof id !== 'string' || !id.startsWith(CUSTOM_ID_PREFIX)) return null;
  const ref = db.collection('custom_landmarks').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const l = snap.data() || {};
  if (typeof l.googlePlaceId === 'string' && l.googlePlaceId) return l.googlePlaceId;
  if (Number.isFinite(l.googleMatchAt) && now - l.googleMatchAt < RETRY_MS) return null;
  if (!l.name || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return null;
  const match = classifyMatch(l, await search(l));
  const placeId = match.status === 'sure' ? match.id : null;
  await ref.update(placeId ? { googlePlaceId: placeId, googleMatchAt: now } : { googleMatchAt: now });
  return placeId;
}
