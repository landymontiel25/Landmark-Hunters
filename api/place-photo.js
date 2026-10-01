import { isRateLimited } from './_lib/rateLimit.js';
import { verifyIdToken } from './_lib/verifyAuth.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal } from './_lib/upstream.js';

// Runtime photo fallback for landmarks that have no image of their own.
// Resolves the landmark to a Google place (Places API (New) Text Search,
// tight location bias + strict name match -- a wrong place's photo is never
// shown), then asks the Place Photos media endpoint for a short-lived
// photoUri and returns it with the photographer attribution Google requires
// the app to display next to the image.
//
// Google Maps Platform terms: nothing here is stored. No image bytes are
// re-hosted, and neither the place id nor the photo reference is written to
// our database or the landmark data -- every call resolves them fresh. The
// only caching is the CDN's few hours on this JSON (Cache-Control below).
//
// Cost control: the field mask is exactly what the name check and the photo
// need (displayName/location/photos bill the Text Search Pro SKU; there is no
// cheaper tier that returns photos). See docs/photos.md.

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
  try {
    const search = await fetch('https://places.googleapis.com/v1/places:searchText', {
      signal: timeoutSignal(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.photos',
      },
      body: JSON.stringify({
        textQuery: name,
        maxResultCount: 5,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_M } },
      }),
    });
    if (!search.ok) {
      res.status(502).json({ error: 'Could not look up a photo.' });
      return;
    }
    const data = await search.json();
    const match = (data.places || []).find(
      (p) =>
        p?.photos?.[0]?.name &&
        p.location &&
        distanceMeters(lat, lng, p.location.latitude, p.location.longitude) <= MAX_DISTANCE_M &&
        namesMatch(name, p.displayName?.text)
    );
    if (!match) {
      // A confident "no photo" is cacheable too -- saves paying again.
      res.setHeader('Cache-Control', EDGE_CACHE);
      res.status(200).json({ url: null, attributions: [] });
      return;
    }

    const photo = match.photos[0];
    const media = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true`, {
      signal: timeoutSignal(),
      headers: { 'X-Goog-Api-Key': apiKey },
    });
    if (!media.ok) {
      res.status(502).json({ error: 'Could not look up a photo.' });
      return;
    }
    const url = safeUri((await media.json())?.photoUri);
    if (!url) {
      res.status(502).json({ error: 'Could not look up a photo.' });
      return;
    }
    const attributions = (photo.authorAttributions || [])
      .map((a) => ({ name: String(a?.displayName || '').slice(0, 100), uri: safeUri(a?.uri) }))
      .filter((a) => a.name);

    res.setHeader('Cache-Control', EDGE_CACHE);
    res.status(200).json({ url, attributions });
  } catch {
    res.status(502).json({ error: 'Could not look up a photo.' });
  }
}

export default withCors(handler);
