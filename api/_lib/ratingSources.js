import { timeoutSignal } from './upstream.js';
import { safeUri } from './placeLookup.js';
import { MAX_SNIPPETS, trimSnippet } from '../../src/lib/ratingSources.js';

// One fetcher per outside source for api/landmark-ratings.js. Each returns a
// normalized result, or null when the source has nothing (or failed): the
// endpoint never fails as a whole because one source did.
//
//   { rating, count, url, ratingImageUrl?, snippets: [...] }
//
// Nothing here is stored anywhere. Google's Places policies allow storing
// only the place ID; ratings, counts and reviews must be fetched fresh.

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
  if (!placeId) return null;
  // Errors throw, so null always means "Google has no rating for this place"
  // (api/landmark-ratings.js tells the app that apart from a failed lookup).
  if (!apiKey) throw new Error('google: no key');
  const r = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    signal: timeoutSignal(RATINGS_TIMEOUT_MS),
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': detail ? GOOGLE_DETAIL_FIELDS : GOOGLE_CARD_FIELDS },
  });
  if (!r.ok) throw new Error(`google ${r.status}`);
  return normalizeGoogle(await r.json(), { detail });
}

export const FETCHERS = { google: fetchGoogle };
