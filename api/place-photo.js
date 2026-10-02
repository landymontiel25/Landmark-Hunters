import { isRateLimited } from './_lib/rateLimit.js';
import { verifyIdToken } from './_lib/verifyAuth.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal, isTimeoutError } from './_lib/upstream.js';
import { PLACE_ID_NO_MATCH_RETRY_MS, PLACE_ID_REFRESH_MS } from './_lib/placeIdConstants.js';
import {
  normalizeName,
  namesMatch,
  safeUri,
  placeIdKey,
  readPlaceId,
  writePlaceId,
  deletePlaceId,
  isFresh,
  sameLandmark,
  logFailure,
  fetchPlaceDetailsPhotos,
  textSearchMatch,
} from './_lib/placeLookup.js';

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

export { normalizeName, namesMatch };

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
