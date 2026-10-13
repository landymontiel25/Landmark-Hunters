import { timeoutSignal } from './upstream.js';
import { safeUri } from './placeLookup.js';
import { MAX_SNIPPETS, TRIPADVISOR_QUOTE_MIN_OVERALL, trimSnippet } from '../../src/lib/ratingSources.js';

// One fetcher per outside source for api/landmark-ratings.js. Each returns a
// normalized result, or null when the source has nothing (or failed): the
// endpoint never fails as a whole because one source did.
//
//   { rating, count, url, ratingImageUrl?, snippets: [...] }
//
// Nothing here is stored anywhere. Google's Places policies and
// Tripadvisor's Terra caching policy allow storing only the place ID /
// location ID; ratings, counts and reviews must be fetched fresh.

export const RATINGS_TIMEOUT_MS = 6000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ---- Google Places API (New): Place Details --------------------------------
// rating / userRatingCount / googleMapsUri are Place Details Enterprise;
// adding `reviews` (detail screen only) is Enterprise + Atmosphere.
const GOOGLE_CARD_FIELDS = 'rating,userRatingCount,googleMapsUri';
const GOOGLE_DETAIL_FIELDS = `${GOOGLE_CARD_FIELDS},reviews`;

export function normalizeGoogle(data, { detail = false } = {}) {
  const rating = num(data?.rating);
  const count = num(data?.userRatingCount);
  const url = safeUri(data?.googleMapsUri);
  if (rating == null || !count || !url) return null;
  const snippets = detail
    ? (Array.isArray(data.reviews) ? data.reviews : [])
        .map((r) => {
          const text = str(r?.text?.text) || str(r?.originalText?.text);
          const author = r?.authorAttribution || {};
          if (!text) return null;
          return {
            text: trimSnippet(text),
            rating: num(r.rating),
            // Google requires the author's name, photo and profile link,
            // and a link to the review itself on Google Maps.
            author: str(author.displayName) || 'Google user',
            authorUrl: safeUri(author.uri),
            authorPhotoUrl: safeUri(author.photoUri),
            when: str(r.relativePublishTimeDescription),
            // Required beside reviews of places in France.
            visitDate: r?.visitDate?.year ? { year: r.visitDate.year, month: r.visitDate.month || null } : null,
            url: safeUri(r.googleMapsUri) || url,
            translated: !!(r?.originalText?.languageCode && r?.text?.languageCode && r.originalText.languageCode !== r.text.languageCode),
          };
        })
        .filter(Boolean)
        .slice(0, MAX_SNIPPETS)
    : [];
  return { rating, count, url, snippets };
}

export async function fetchGoogle(placeId, { detail = false, apiKey = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch } = {}) {
  if (!placeId || !apiKey) return null;
  const r = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    signal: timeoutSignal(RATINGS_TIMEOUT_MS),
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': detail ? GOOGLE_DETAIL_FIELDS : GOOGLE_CARD_FIELDS },
  });
  if (!r.ok) {
    console.warn(`landmark-ratings: google ${r.status}`);
    return null;
  }
  return normalizeGoogle(await r.json(), { detail });
}

// ---- Tripadvisor Terra (the Content API's replacement) --------------------
// Location Details for the rating; Location Reviews for quotes (detail only).
// A location must be on the account's allowlist or Terra answers 404.
const TERRA = 'https://terra.tripadvisor.com/api';

const primaryText = (list) => {
  if (!Array.isArray(list)) return null;
  const pick = list.find((t) => t?.language === 'en') || list.find((t) => t?.primary) || list[0];
  return str(pick?.value);
};

export function normalizeTripadvisor(location, reviews = null) {
  const overall = location?.traveler_ratings?.overall;
  const rating = num(overall?.rating);
  const count = num(overall?.count);
  const url = safeUri(location?.urls?.tripadvisor?.main);
  if (rating == null || !count || !url) return null;
  // Quotes only from 5-bubble reviews, only when the place is rated 4+, with
  // the review date (Tripadvisor's rule for quoting traveler reviews).
  const snippets =
    rating >= TRIPADVISOR_QUOTE_MIN_OVERALL && Array.isArray(reviews?.data)
      ? reviews.data
          .filter((rv) => rv?.rating === 5 && primaryText(rv.text) && str(rv.publish_ts))
          .map((rv) => ({
            text: trimSnippet(primaryText(rv.text)),
            rating: 5,
            ratingImageUrl: safeUri(rv?.rating_icon_url?.url),
            author: str(rv?.user?.username),
            date: str(rv.publish_ts).slice(0, 10),
            url: safeUri(rv.url) || url,
          }))
          .slice(0, MAX_SNIPPETS)
      : [];
  return { rating, count, url, ratingImageUrl: safeUri(overall?.icon_url), snippets };
}

async function terraGet(path, apiKey, fetchImpl) {
  const r = await fetchImpl(`${TERRA}${path}`, {
    signal: timeoutSignal(RATINGS_TIMEOUT_MS),
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  });
  if (!r.ok) {
    console.warn(`landmark-ratings: tripadvisor ${r.status} on ${path.split('?')[0]}`);
    return null;
  }
  return r.json();
}

export async function fetchTripadvisor(locationId, { detail = false, apiKey = process.env.TRIPADVISOR_API_KEY, fetchImpl = fetch } = {}) {
  if (!locationId || !/^\d+$/.test(String(locationId)) || !apiKey) return null;
  const id = encodeURIComponent(locationId);
  const [location, reviews] = await Promise.all([
    terraGet(`/locations/${id}?version=1&locale=en-US`, apiKey, fetchImpl),
    detail ? terraGet(`/locations/${id}/reviews?version=1&language=en&rating_min=5&size=10`, apiKey, fetchImpl).catch(() => null) : null,
  ]);
  return location ? normalizeTripadvisor(location, reviews) : null;
}

export const FETCHERS = { google: fetchGoogle, tripadvisor: fetchTripadvisor };
