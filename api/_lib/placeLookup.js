import { timeoutSignal } from './upstream.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { PLACE_ID_COLLECTION, PLACE_ID_FIRESTORE_TIMEOUT_MS } from './placeIdConstants.js';

// Shared by api/place-photo.js (a tile's runtime lookup) and the admin photo
// backfill (api/_lib/photoBackfill.js): the same strict Google place matching
// and the same place_ids cache, so a backfill can never save a match the app
// would reject.

export const SEARCH_RADIUS_M = 250;
export const MAX_DISTANCE_M = 250;

export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'de', 'la', 'le', 'el', 'los', 'las']);
const tokens = (s) => normalizeName(s).split(' ').filter((t) => t && !STOP.has(t));

// Strict enough that "Joe's Pizza" never matches "Joe's Pizza Supply" by
// accident, loose enough that "Liberty Bell" matches "Liberty Bell Center".
export function namesMatch(wanted, found) {
  const a = tokens(wanted);
  const b = tokens(found);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((t) => setB.has(t)).length;
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  // One name wholly contained in the other, and the shorter one is
  // distinctive (2+ words, or a single long word) and covers half of it.
  if (shared === small.size && (small.size >= 2 || [...small][0].length >= 6) && small.size / large.size >= 0.5) return true;
  // Otherwise require strong overlap both ways.
  return shared / setA.size >= 0.8 && shared / setB.size >= 0.8;
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function safeUri(uri) {
  if (typeof uri !== 'string' || !uri) return null;
  const full = uri.startsWith('//') ? `https:${uri}` : uri;
  try {
    const u = new URL(full);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- Place-ID cache (Firestore place_ids/{region}__{landmarkId}) -----------
// Read and written ONLY here, via the Admin SDK (which bypasses rules; the
// rules deny every client read/write). Holds no user data, so account
// deletion has nothing to remove. Google's terms allow storing place IDs; we
// never store photo bytes, photo names or photoUris. Any failure here
// (credentials missing, Firestore down) degrades to the uncached behavior.

let warnedNoAdmin = false;

export function placeIdKey(region, id) {
  const ok = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(v) && v !== '.' && v !== '..';
  return ok(region) && ok(id) ? `${region}__${id}` : null;
}

function withTimeout(promise) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error('Firestore timed out')), PLACE_ID_FIRESTORE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(t));
}

function placeIdDoc(key) {
  try {
    return adminDb().collection(PLACE_ID_COLLECTION).doc(key);
  } catch (e) {
    if (!warnedNoAdmin) {
      warnedNoAdmin = true;
      console.warn(`place-photo: place-ID cache disabled, doing a Text Search every time (${e?.message || e})`);
    }
    return null;
  }
}

export async function readPlaceId(key) {
  const ref = placeIdDoc(key);
  if (!ref) return null;
  try {
    const snap = await withTimeout(ref.get());
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.warn(`place-photo: place-ID cache read failed for ${key}: ${e?.message || e}`);
    return null;
  }
}

export async function writePlaceId(key, { status, placeId, matchedName, lat, lng }) {
  const ref = placeIdDoc(key);
  if (!ref) return;
  try {
    // Exactly these fields; never photo names, URIs or bytes.
    await withTimeout(ref.set({ placeId, matchedName, lat, lng, verifiedAt: FieldValue.serverTimestamp(), source: 'text-search', status }));
  } catch (e) {
    console.warn(`place-photo: place-ID cache write failed for ${key}: ${e?.message || e}`);
  }
}

export async function deletePlaceId(key) {
  const ref = placeIdDoc(key);
  if (!ref) return;
  try {
    await withTimeout(ref.delete());
  } catch (e) {
    console.warn(`place-photo: place-ID cache delete failed for ${key}: ${e?.message || e}`);
  }
}

export function verifiedMs(doc) {
  const v = doc?.verifiedAt;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return typeof v === 'number' ? v : 0;
}
export const isFresh = (doc, windowMs) => Date.now() - verifiedMs(doc) < windowMs;

// The request's name/coordinates come from the client, so only trust a stored
// doc when they still describe the place it was verified for.
export function sameLandmark(doc, name, lat, lng) {
  if (!Number.isFinite(doc?.lat) || !Number.isFinite(doc?.lng)) return false;
  if (distanceMeters(lat, lng, doc.lat, doc.lng) > MAX_DISTANCE_M) return false;
  return doc.status === 'no-match' || namesMatch(name, doc.matchedName);
}

// One short line per failed Google step, so a 502 can be diagnosed from
// Vercel's Logs. Step + HTTP status (or error name) + the landmark's cache key
// only: never the API key, the request headers or any response body.
export function logFailure(step, detail, key) {
  console.warn(`place-photo: ${step} failed (${detail})${key ? ` for ${key}` : ''}`);
}

export async function fetchPlaceDetailsPhotos(placeId, apiKey) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    signal: timeoutSignal(),
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'photos' },
  });
  // 404 NOT_FOUND = obsolete ID; 400 = malformed/invalid ID.
  if (r.status === 404 || r.status === 400) return { ok: false, stale: true };
  if (!r.ok) return { ok: false, stale: false, status: r.status };
  const data = await r.json();
  return { ok: true, photo: data?.photos?.[0] || null };
}

export async function textSearchMatch(name, lat, lng, apiKey) {
  const search = await fetch('https://places.googleapis.com/v1/places:searchText', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      // places.id is IDs-only (free tier), so it adds nothing on top of the Pro fields.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos',
    },
    body: JSON.stringify({
      textQuery: name,
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_M } },
    }),
  });
  if (!search.ok) return { error: true, status: search.status };
  const data = await search.json();
  const match = (data.places || []).find(
    (p) =>
      p?.photos?.[0]?.name &&
      p.location &&
      distanceMeters(lat, lng, p.location.latitude, p.location.longitude) <= MAX_DISTANCE_M &&
      namesMatch(name, p.displayName?.text)
  );
  return { match: match || null };
}

