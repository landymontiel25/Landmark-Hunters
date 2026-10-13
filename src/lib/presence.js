// Verified presence (docs/discovery-network-plan.md, Phase 0): did the user
// stand at the place when they checked in? The server decides
// (api/verify-checkin.js) and writes `presence` on the check-in; the rules
// stop any client from writing it. This file is the shared, pure logic, with
// no Firebase imports, so the endpoint and the app read the same numbers.

// Radius and GPS accuracy limit by place type (plan v2). Starting values:
// tune them on real phones in the week after Phase 0 ships.
export const PRESENCE_LIMITS = {
  landmark: { radiusMeters: 30, maxAccuracyMeters: 50 }, // statue, building, single landmark
  indoor: { radiusMeters: 60, maxAccuracyMeters: 100 }, // museum or indoor site
  area: { radiusMeters: 150, maxAccuracyMeters: 100 }, // park, campus, beach, neighborhood
};

// A check-in can be verified only this soon after it was made, with a fix
// this fresh, and never after travel faster than a plane since the last
// verified check-in.
export const PRESENCE_CHECKIN_MAX_AGE_MS = 10 * 60 * 1000;
export const PRESENCE_FIX_MAX_AGE_MS = 2 * 60 * 1000;
// A fix stamped this far in the future (phone clock ahead) still counts.
export const PRESENCE_FIX_CLOCK_SKEW_MS = 30 * 1000;
export const PRESENCE_MAX_SPEED_KMH = 900;

// Topics (imported places) and words in a name that mark each type. A place
// matches `area` first, then `indoor`; anything else is a single landmark.
const AREA_RE =
  /\b(park|parks|garden|gardens|beach|beaches|campus|university|college|neighbou?rhood|district|quarter|village|island|preserve|reserve|trail|zoo|stadium|arena|ballpark|field|fields|circuit|raceway|speedway|airport|golf|marina|square|plaza|piazza|boardwalk|promenade|lake|forest|canyon|valley|bay|bridge|pier|wharf|harbor|harbour|waterfront|mountain|hill|cemetery)\b/i;
const INDOOR_RE =
  /\b(museum|gallery|theater|theatre|cinema|library|hall|restaurant|café|cafe|coffee|bar|pub|tavern|brewery|winery|bakery|nightclub|club|shop|store|bookstore|market|mall|center|centre|arts center|ice cream|gelato|deli|diner|bistro|trattoria|pizzeria|steakhouse|lounge|aquarium|church|cathedral|basilica|chapel|synagogue|mosque|station)\b/i;
const AREA_CATEGORIES = new Set(['parks-nature', 'campus-life', 'stadiums', 'formula-1', 'airports']);
const INDOOR_CATEGORIES = new Set(['food', 'art-museums']);

// 'landmark' | 'indoor' | 'area' for a catalog, pack or custom place.
export function placeTypeFor(place) {
  const topic = typeof place?.topic === 'string' ? place.topic : '';
  const name = typeof place?.name === 'string' ? place.name : '';
  const cats = Array.isArray(place?.categories) ? place.categories : place?.category ? [place.category] : [];
  // An imported place's topic is the most specific signal it has.
  if (topic) {
    if (AREA_RE.test(topic)) return 'area';
    if (INDOOR_RE.test(topic)) return 'indoor';
  }
  if (AREA_RE.test(name)) return 'area';
  if (INDOOR_RE.test(name)) return 'indoor';
  if (cats.some((c) => AREA_CATEGORIES.has(c))) return 'area';
  if (cats.some((c) => INDOOR_CATEGORIES.has(c))) return 'indoor';
  return 'landmark';
}

export function presenceLimitsFor(place) {
  return PRESENCE_LIMITS[placeTypeFor(place)];
}

const toRad = (d) => (d * Math.PI) / 180;
export function metersBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// A fix as the app sends it: { lat, lng, accuracy, timestamp (ms) }, plus an
// optional `mocked` flag once the Android build reports it.
export function validFix(fix) {
  return (
    !!fix &&
    finite(fix.lat) &&
    finite(fix.lng) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lng) <= 180 &&
    finite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    finite(fix.timestamp) &&
    (fix.mocked === undefined || typeof fix.mocked === 'boolean')
  );
}

// The server's decision. `checkinAtMs` is the check-in's createdAt, `last`
// the user's previous verified fix ({ lat, lng, atMs }) or null. Returns
// { verified, reason, placeType, distanceMeters, accuracyMeters }; reason is
// null on a pass. Order matters: the first failing check is the reason shown.
export function checkPresence({ place, fix, nowMs, checkinAtMs, last = null }) {
  const placeType = placeTypeFor(place);
  const { radiusMeters, maxAccuracyMeters } = PRESENCE_LIMITS[placeType];
  const out = (reason, extra = {}) => ({ verified: reason == null, reason, placeType, distanceMeters: null, accuracyMeters: null, ...extra });
  if (!finite(place?.lat) || !finite(place?.lng)) return out('no-place');
  if (!validFix(fix)) return out('no-location');
  const distance = Math.round(metersBetween(fix.lat, fix.lng, place.lat, place.lng));
  const accuracy = Math.round(fix.accuracy * 10) / 10;
  const measured = { distanceMeters: distance, accuracyMeters: accuracy };
  if (!finite(checkinAtMs) || nowMs - checkinAtMs > PRESENCE_CHECKIN_MAX_AGE_MS) return out('stale-checkin', measured);
  if (nowMs - fix.timestamp > PRESENCE_FIX_MAX_AGE_MS || fix.timestamp - nowMs > PRESENCE_FIX_CLOCK_SKEW_MS) {
    return out('stale-fix', measured);
  }
  if (fix.mocked === true) return out('mocked', measured);
  if (accuracy > maxAccuracyMeters) return out('weak-signal', measured);
  if (distance > radiusMeters) return out('too-far', measured);
  if (last && finite(last.lat) && finite(last.lng) && finite(last.atMs)) {
    const km = metersBetween(last.lat, last.lng, fix.lat, fix.lng) / 1000;
    const hours = Math.max(fix.timestamp - last.atMs, 0) / 3600000;
    // Under 1 km apart never trips this (GPS jitter between two fixes).
    if (km > 1 && (hours === 0 || km / hours > PRESENCE_MAX_SPEED_KMH)) return out('impossible-travel', measured);
  }
  return out(null, measured);
}

// What the app shows for a check-in's `presence`. Null when the check-in has
// none (an old check-in, or one made with location off).
export function presenceLabel(presence) {
  if (!presence || typeof presence !== 'object') return null;
  if (presence.verified === true) return 'Verified visit';
  switch (presence.reason) {
    case 'too-far':
      // Never a distance: nobody, the owner included, sees how far away a
      // check-in was (it stays in the server-only proof).
      return 'Not verified: too far away';
    case 'weak-signal':
      return 'Not verified: too weak a signal';
    case 'stale-fix':
    case 'stale-checkin':
      return 'Not verified: location came too late';
    case 'impossible-travel':
      return 'Not verified: too far from your last verified visit';
    case 'mocked':
      return 'Not verified: simulated location';
    case 'no-place':
      return 'Not verified: this place has no map point';
    default:
      return 'Not verified';
  }
}
