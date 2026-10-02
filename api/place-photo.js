import { isRateLimited } from './_lib/rateLimit.js';
import { verifyIdToken } from './_lib/verifyAuth.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal, isTimeoutError } from './_lib/upstream.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
  PLACE_ID_COLLECTION,
  PLACE_ID_FIRESTORE_TIMEOUT_MS,
  PLACE_ID_NO_MATCH_RETRY_MS,
  PLACE_ID_REFRESH_MS,
} from './_lib/placeIdConstants.js';

// Runtime photo fallback for landmarks that have no image of their own.
// Resolves the landmark to a Google place (Places API (New) Text Search,
// tight location bias + strict name match -- a wrong place's photo is never
// shown), then asks the Place Photos media endpoint for a short-lived
// photoUri and returns it with the photographer attribution Google requires
// the app to display next to the image.
//
// Google Maps Platform terms: image bytes are never re-hosted and photo
// names / photoUris are never stored -- each view fetches a fresh photo
// reference. The one thing persisted is the place ID (which the terms allow)
// in the server-only place_ids collection, so the expensive Text Search runs
// once per landmark instead of on every view. Plus the CDN's few hours on
// this JSON (Cache-Control below).
//
// Cost control: see docs/photos.md for the SKU math.

const SEARCH_RADIUS_M = 250;
const MAX_DISTANCE_M = 250;

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

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function safeUri(uri) {
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

function placeIdKey(region, id) {
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

async function readPlaceId(key) {
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

async function writePlaceId(key, { status, placeId, matchedName, lat, lng }) {
  const ref = placeIdDoc(key);
  if (!ref) return;
  try {
    // Exactly these fields; never photo names, URIs or bytes.
    await withTimeout(ref.set({ placeId, matchedName, lat, lng, verifiedAt: FieldValue.serverTimestamp(), source: 'text-search', status }));
  } catch (e) {
    console.warn(`place-photo: place-ID cache write failed for ${key}: ${e?.message || e}`);
  }
}

async function deletePlaceId(key) {
  const ref = placeIdDoc(key);
  if (!ref) return;
  try {
    await withTimeout(ref.delete());
  } catch (e) {
    console.warn(`place-photo: place-ID cache delete failed for ${key}: ${e?.message || e}`);
  }
}

function verifiedMs(doc) {
  const v = doc?.verifiedAt;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return typeof v === 'number' ? v : 0;
}
const isFresh = (doc, windowMs) => Date.now() - verifiedMs(doc) < windowMs;

// The request's name/coordinates come from the client, so only trust a stored
// doc when they still describe the place it was verified for.
function sameLandmark(doc, name, lat, lng) {
  if (!Number.isFinite(doc?.lat) || !Number.isFinite(doc?.lng)) return false;
  if (distanceMeters(lat, lng, doc.lat, doc.lng) > MAX_DISTANCE_M) return false;
  return doc.status === 'no-match' || namesMatch(name, doc.matchedName);
}

// One short line per failed Google step, so a 502 can be diagnosed from
// Vercel's Logs. Step + HTTP status (or error name) + the landmark's cache key
// only: never the API key, the request headers or any response body.
function logFailure(step, detail, key) {
  console.warn(`place-photo: ${step} failed (${detail})${key ? ` for ${key}` : ''}`);
}

async function fetchPlaceDetailsPhotos(placeId, apiKey) {
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

async function textSearchMatch(name, lat, lng, apiKey) {
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

// Edge only (s-maxage), never the browser's own cache: the CDN may reuse this
// JSON for a few hours across users; max-age=0 keeps clients re-asking us.
const EDGE_CACHE = 'public, max-age=0, s-maxage=10800, stale-while-revalidate=3600';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Photos are not set up yet. Add GOOGLE_PLACES_API_KEY in Vercel.' });
    return;
  }
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ code: 'sign-in-required', error: 'Sign in to see photos.' });
    return;
  }
  if (isRateLimited(req, 'place-photo', { limit: 90, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests in a row — slow down a bit.' });
    return;
  }

  const name = String(req.query?.name ?? '').trim();
  const rawLat = req.query?.lat;
  const rawLng = req.query?.lng;
  const lat = rawLat === '' || rawLat == null ? NaN : Number(rawLat);
  const lng = rawLng === '' || rawLng == null ? NaN : Number(rawLng);
  if (!name || name.length > 150 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: 'Missing or invalid name or location.' });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const cacheKey = placeIdKey(req.query?.region, req.query?.id);
  const fail = () => res.status(502).json({ error: 'Could not look up a photo.' });
  let step = 'photo lookup'; // which Google call the catch below was in
  const noPhoto = () => {
    // A confident "no photo" is cacheable too -- saves paying again.
    res.setHeader('Cache-Control', EDGE_CACHE);
    res.status(200).json({ url: null, attributions: [] });
  };
  try {
    const cached = cacheKey ? await readPlaceId(cacheKey) : null;
    const trusted = cached && sameLandmark(cached, name, lat, lng);
    let placeId = null;
    let photo = null;

    if (trusted && cached.status === 'no-match' && isFresh(cached, PLACE_ID_NO_MATCH_RETRY_MS)) {
      noPhoto();
      return;
    }

    if (trusted && cached.status === 'ok' && cached.placeId) {
      // Place Details with the photos field only = the free "IDs Only" SKU.
      const details = await fetchPlaceDetailsPhotos(cached.placeId, apiKey);
      if (details.ok) {
        placeId = cached.placeId;
        photo = details.photo;
        // Past the refresh window: this free call just re-verified the ID.
        if (!isFresh(cached, PLACE_ID_REFRESH_MS)) await writePlaceId(cacheKey, cached);
      } else if (details.stale) {
        console.warn(`place-photo: stored place ID for ${cacheKey} is obsolete; re-searching once`);
        await deletePlaceId(cacheKey);
      } else {
        logFailure('photo lookup', `Google status ${details.status}`, cacheKey);
        fail();
        return;
      }
    }

    if (!placeId) {
      step = 'search';
      const found = await textSearchMatch(name, lat, lng, apiKey);
      if (found.error) {
        logFailure('search', `Google status ${found.status}`, cacheKey);
        fail();
        return;
      }
      if (!found.match) {
        if (cacheKey) await writePlaceId(cacheKey, { status: 'no-match', placeId: null, matchedName: null, lat, lng });
        noPhoto();
        return;
      }
      placeId = found.match.id || null;
      photo = found.match.photos[0];
      if (cacheKey && placeId) {
        await writePlaceId(cacheKey, { status: 'ok', placeId, matchedName: String(found.match.displayName?.text || '').slice(0, 200), lat, lng });
      }
    }

    if (!photo?.name) {
      noPhoto();
      return;
    }
    step = 'image fetch';
    const media = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true`, {
      signal: timeoutSignal(),
      headers: { 'X-Goog-Api-Key': apiKey },
    });
    if (!media.ok) {
      logFailure('image fetch', `Google status ${media.status}`, cacheKey);
      fail();
      return;
    }
    const url = safeUri((await media.json())?.photoUri);
    if (!url) {
      logFailure('image fetch', 'no https photoUri in the reply', cacheKey);
      fail();
      return;
    }
    const attributions = (photo.authorAttributions || [])
      .map((a) => ({ name: String(a?.displayName || '').slice(0, 100), uri: safeUri(a?.uri) }))
      .filter((a) => a.name);

    res.setHeader('Cache-Control', EDGE_CACHE);
    res.status(200).json({ url, attributions });
  } catch (e) {
    if (isTimeoutError(e)) logFailure('timeout', `during ${step}`, cacheKey);
    else logFailure(step, `error ${e?.name || 'Error'}`, cacheKey);
    fail();
  }
}

export default withCors(handler);
