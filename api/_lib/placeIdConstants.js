// Tuning knobs for the place-ID cache in api/place-photo.js (see docs/photos.md).
const DAY_MS = 24 * 60 * 60 * 1000;

// Google recommends refreshing stored place IDs older than 12 months. The
// refresh is a free Place Details call (IDs-only field mask): when a stored ID
// is older than this, the normal photo lookup re-verifies it and bumps
// verifiedAt (an obsolete ID falls back to one fresh Text Search).
export const PLACE_ID_REFRESH_MS = 365 * DAY_MS;

// A "Google couldn't match this landmark" result is remembered this long so we
// stop paying for a Text Search every time a tile for it is viewed. Short,
// because Google's data (and our catalog's coordinates) improve over time.
export const PLACE_ID_NO_MATCH_RETRY_MS = 30 * DAY_MS;

// Firestore collection (Admin SDK only; rules deny all client access).
export const PLACE_ID_COLLECTION = 'place_ids';

// Never let a slow Firestore stall the photo request.
export const PLACE_ID_FIRESTORE_TIMEOUT_MS = 3000;
