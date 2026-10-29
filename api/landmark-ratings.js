import { readFileSync } from 'node:fs';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { FETCHERS } from './_lib/ratingSources.js';
import { CUSTOM_ID_PREFIX, customGooglePlaceId } from './_lib/customRatingMatch.js';
import { catalogGooglePlaceId } from './_lib/catalogRatingMatch.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { OUTSIDE_SOURCES, ratingKey } from '../src/lib/ratingSources.js';
import { canonicalRegionId, getLandmark } from '../src/data/regions.js';

// GET /api/landmark-ratings?region=&id=[&detail=1]
// Ratings for one landmark from each outside source (docs/ratings.md):
//   { sources: { google: {...} | null, tripadvisor: {...} | null }, googleNoRating }
// A source with no ID for this landmark, no key, no data or an error is
// null; the request itself still answers 200. googleNoRating says the null
// is final (no Google listing, or one with no rating), not an error.
//
// Keys stay here: GOOGLE_PLACES_API_KEY and TRIPADVISOR_API_KEY are server
// env vars and never appear in a response. Sign-in plus a per-account limit,
// the same gate the AI endpoints use (api/_lib/aiGuard.js), since every call
// is billed. No result is cached: Google and Tripadvisor allow storing only
// their IDs (src/data/ratingSourceIds.json), never ratings or reviews.
// robots.txt blocks this path: Tripadvisor requires review text to load
// through a call crawlers can't fetch.

export const RATINGS_LIMIT = { limit: 150, windowMs: 10 * 60 * 1000 };

let idsCache = null;
export function ratingIds() {
  if (!idsCache) {
    try {
      idsCache = JSON.parse(readFileSync(new URL('../src/data/ratingSourceIds.json', import.meta.url), 'utf8'));
    } catch (e) {
      console.warn(`landmark-ratings: no ID map (${e?.message || e})`);
      idsCache = {};
    }
  }
  return idsCache;
}
export const _setRatingIds = (map) => {
  idsCache = map;
};

let customLookup = (id) => customGooglePlaceId(adminDb(), id);
// Tests only.
export const _setCustomLookup = (fn) => {
  customLookup = fn;
};

// A catalog landmark with no ID in the map: matched here the first time
// anyone asks (api/_lib/catalogRatingMatch.js). The name and coordinates come
// from the request, as they do for photos; the match is checked against them.
let catalogLookup = (l) => catalogGooglePlaceId(l);
// Tests only.
export const _setCatalogLookup = (fn) => {
  catalogLookup = fn;
};

const ID_FIELD = { google: 'googlePlaceId', tripadvisor: 'tripadvisorLocationId' };
const SAFE = /^[A-Za-z0-9_.:-]{1,100}$/;

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const account = await guardAiRequest(req, res, { key: 'landmark-ratings', ...RATINGS_LIMIT });
  if (!account) return;

  const region = String(req.query?.region || '');
  const id = String(req.query?.id || '');
  if (!SAFE.test(region) || !SAFE.test(id)) {
    res.status(400).json({ error: 'Missing or invalid landmark.' });
    return;
  }
  const detail = req.query?.detail === '1';
  let ids = ratingIds()[ratingKey(canonicalRegionId(region), id)] || {};
  // A landmark a user added: its Google ID lives on its own doc, found the
  // first time anyone asks (api/_lib/customRatingMatch.js).
  let customLookupFailed = false;
  if (!ids.googlePlaceId && id.startsWith(CUSTOM_ID_PREFIX)) {
    try {
      const googlePlaceId = await customLookup(id);
      if (googlePlaceId) ids = { ...ids, googlePlaceId };
    } catch (e) {
      customLookupFailed = true;
      console.warn(`landmark-ratings: custom match failed (${e?.message || 'error'})`);
    }
  }

  if (!ids.googlePlaceId && !id.startsWith(CUSTOM_ID_PREFIX)) {
    const name = String(req.query?.name || '').slice(0, 200);
    const lat = Number(req.query?.lat);
    const lng = Number(req.query?.lng);
    const canonical = canonicalRegionId(region);
    try {
      const googlePlaceId = await catalogLookup({
        region: canonical,
        id,
        name,
        lat,
        lng,
        categories: getLandmark(canonical, id)?.categories || [],
      });
      if (googlePlaceId) ids = { ...ids, googlePlaceId };
    } catch (e) {
      customLookupFailed = true;
      console.warn(`landmark-ratings: catalog match failed (${e?.message || 'error'})`);
    }
  }

  const results = await Promise.allSettled(
    OUTSIDE_SOURCES.map((s) => (ids[ID_FIELD[s]] ? FETCHERS[s](ids[ID_FIELD[s]], { detail }) : Promise.resolve(null)))
  );
  const sources = {};
  OUTSIDE_SOURCES.forEach((s, i) => {
    const r = results[i];
    if (r.status === 'rejected') console.warn(`landmark-ratings: ${s} failed (${r.reason?.name || 'error'})`);
    sources[s] = r.status === 'fulfilled' ? r.value || null : null;
  });

  // True only when Google has nothing to show for this place: we have no
  // Google listing for it, or the listing has no rating. A failed lookup
  // leaves it false, so the app never says "No ratings available" because
  // Google was slow.
  const g = results[OUTSIDE_SOURCES.indexOf('google')];
  const googleNoRating = !customLookupFailed && (!ids.googlePlaceId || (g.status === 'fulfilled' && !g.value));

  // Never cached by browsers or the CDN (see above).
  res.setHeader?.('Cache-Control', 'no-store');
  res.status(200).json({ landmarkId: id, detail, sources, googleNoRating });
}

export default withCors(handler);
