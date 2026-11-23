import { distanceMeters } from './geo';
import { REQUIRE_GPS_CHECKIN, CHECKIN_RULE_METERS, CHECKIN_MAX_ACCURACY_METERS } from './maprConstants';
import { presenceLimitsFor, PRESENCE_MAX_RADIUS_METERS } from './presence';

// How close you must be to this place: its own radius (big venues like parks
// and malls set checkInRadiusMeters) or the default CHECKIN_RULE_METERS.
// Never less than the server's own limit for this kind of place
// (presence.js: 150 m for a park or campus), so the phone never refuses a
// visit the server would verify.
export const radiusFor = (landmark) =>
  Math.max(
    Number.isFinite(landmark?.checkInRadiusMeters) && landmark.checkInRadiusMeters > 0
      ? Math.min(landmark.checkInRadiusMeters, PRESENCE_MAX_RADIUS_METERS)
      : CHECKIN_RULE_METERS,
    presenceLimitsFor(landmark).radiusMeters
  );

// Distance and accuracy for a check-in, from the user's GPS fix to the place.
// Each is null when it cannot be computed (no fix, or a place without
// coordinates). Rounded: they are saved on the check-in.
export function measureCheckin(coords, landmark) {
  const hasPlace = Number.isFinite(landmark?.lat) && Number.isFinite(landmark?.lng);
  const hasFix = Number.isFinite(coords?.lat) && Number.isFinite(coords?.lng);
  const distance = hasPlace && hasFix ? distanceMeters(coords.lat, coords.lng, landmark.lat, landmark.lng) : null;
  const accuracy = hasFix && Number.isFinite(coords?.accuracy) && coords.accuracy >= 0 ? coords.accuracy : null;
  return {
    distanceMeters: distance == null ? null : Math.round(distance),
    gpsAccuracyMeters: accuracy == null ? null : Math.round(accuracy * 10) / 10,
  };
}

// How rough a GPS fix may be: the server's own limit for this kind of place
// (presence.js), never stricter than CHECKIN_MAX_ACCURACY_METERS.
export const maxAccuracyFor = (landmark) => Math.max(CHECKIN_MAX_ACCURACY_METERS, presenceLimitsFor(landmark).maxAccuracyMeters);

// Is this fix good enough, and close enough, to count as being at the place?
export function isNearEnough(coords, landmark) {
  const { distanceMeters: d, gpsAccuracyMeters: a } = measureCheckin(coords, landmark);
  if (d == null || a == null) return false;
  return a <= maxAccuracyFor(landmark) && d <= radiusFor(landmark);
}

// Why a check-in is refused when the rule is on, or null when it may go
// ahead. Rating-only claims are never refused (they are not visits).
// anywhere: the admin's check-in-from-anywhere switch (admins.js).
export function checkinBlockReason(coords, landmark, { ratingOnly = false, required = REQUIRE_GPS_CHECKIN, anywhere = false } = {}) {
  if (!required || ratingOnly || anywhere) return null;
  const { distanceMeters: d, gpsAccuracyMeters: a } = measureCheckin(coords, landmark);
  if (d == null || a == null) return 'no-location';
  if (a > maxAccuracyFor(landmark)) return 'weak-signal';
  if (d > radiusFor(landmark)) return 'too-far';
  return null;
}

export const BLOCK_MESSAGES = {
  'no-location': 'Turn on location to check in here.',
  'weak-signal': 'Your GPS signal is too weak to tell where you are. Step outside or wait a moment.',
  'too-far': 'You need to be at this place to check in.',
};

// The fields the phone saves on every real check-in: only
// `verification: 'unverified'`. Verified presence is the server's call
// (api/verify-checkin.js writes `presence`; src/lib/presence.js), and the
// distance and accuracy go to its server-only proof doc, not the readable
// check-in. firestore.rules refuses 'verified' from a client.
export function checkinLocationFields() {
  return { verification: 'unverified' };
}
