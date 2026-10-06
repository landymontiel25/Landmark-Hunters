import { DECAY_DISTANCE_KM, DECAY_MIN_DISTANCE_KM } from './config.js';

// Week 1: closer landmarks score higher.
//   score_adjusted = score * 1 / (1 + distance_km / DECAY_DISTANCE_KM)
// 0 km -> x1.0, 0.5 km -> x0.75, 1.5 km -> x0.5, 3 km -> x0.33, 5 km -> x0.23.
// Only the ratio between two places matters for the ranking, so the curve's
// overall scale does not change which place wins.

const EARTH_RADIUS_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

// Great-circle distance in km. NaN when any coordinate is missing.
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return NaN;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Multiplier in (0, 1]. Unknown, negative or zero distance -> 1 (no change).
export function decayMultiplier(distanceKm, decayKm = DECAY_DISTANCE_KM) {
  const d = Number.isFinite(distanceKm) && distanceKm > DECAY_MIN_DISTANCE_KM ? distanceKm : 0;
  const k = Number.isFinite(decayKm) && decayKm > 0 ? decayKm : DECAY_DISTANCE_KM;
  return 1 / (1 + d / k);
}

// Applies the multiplier so that nearer is always better: a positive score
// shrinks with distance, a negative one grows more negative (dividing), and
// zero stays zero (the caller breaks ties by distance).
export function applyDecay(score, distanceKm, decayKm = DECAY_DISTANCE_KM) {
  const s = Number.isFinite(score) ? score : 0;
  const m = decayMultiplier(distanceKm, decayKm);
  return s >= 0 ? s * m : s / m;
}
