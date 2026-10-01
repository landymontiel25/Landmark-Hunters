import { distanceMeters } from './geo';
import { REQUIRE_GPS_CHECKIN, CHECKIN_RULE_METERS, CHECKIN_MAX_ACCURACY_METERS } from './maprConstants';

// How close you must be to this place: its own radius (big venues like parks
// and malls set checkInRadiusMeters) or the default CHECKIN_RULE_METERS.
export const radiusFor = (landmark) =>
  Number.isFinite(landmark?.checkInRadiusMeters) && landmark.checkInRadiusMeters > 0
    ? landmark.checkInRadiusMeters
    : CHECKIN_RULE_METERS;

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

// Is this fix good enough, and close enough, to count as being at the place?
export function isNearEnough(coords, landmark) {
  const { distanceMeters: d, gpsAccuracyMeters: a } = measureCheckin(coords, landmark);
  if (d == null || a == null) return false;
  return a <= CHECKIN_MAX_ACCURACY_METERS && d <= radiusFor(landmark);
}

// Why a check-in is refused when the rule is on, or null when it may go
// ahead. Rating-only claims are never refused (they are not visits).
export function checkinBlockReason(coords, landmark, { ratingOnly = false, required = REQUIRE_GPS_CHECKIN } = {}) {
  if (!required || ratingOnly) return null;
  const { distanceMeters: d, gpsAccuracyMeters: a } = measureCheckin(coords, landmark);
  if (d == null || a == null) return 'no-location';
  if (a > CHECKIN_MAX_ACCURACY_METERS) return 'weak-signal';
  if (d > radiusFor(landmark)) return 'too-far';
  return null;
}

export const BLOCK_MESSAGES = {
  'no-location': 'Turn on location to check in here.',
  'weak-signal': 'Your GPS signal is too weak to tell where you are. Step outside or wait a moment.',
  'too-far': 'You need to be at this place to check in.',
};

// The fields saved on every real check-in. 'verified' only when the rule is
// on and the fix passes it; 'unverified' when the rule is off or the distance
// could not be computed.
export function checkinLocationFields(coords, landmark, { required = REQUIRE_GPS_CHECKIN } = {}) {
  const m = measureCheckin(coords, landmark);
  const verified = required && m.distanceMeters != null && isNearEnough(coords, landmark);
  return {
    ...(m.distanceMeters != null ? { distanceMeters: m.distanceMeters } : {}),
    ...(m.gpsAccuracyMeters != null ? { gpsAccuracyMeters: m.gpsAccuracyMeters } : {}),
    verification: verified ? 'verified' : 'unverified',
  };
}
