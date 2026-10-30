import { presenceLimitsFor } from './presence';

// The bubble drawn on the Map when you tap a landmark (like Life360's place
// circles): the landmark's own footprint plus a margin on every side.
// The footprint is its check-in radius when it sets one (parks, malls,
// districts), else the radius for its kind of place (presence.js).
export const BUBBLE_MARGIN_METERS = 30;

export function bubbleRadius(landmark) {
  const own = landmark?.checkInRadiusMeters;
  const footprint = Number.isFinite(own) && own > 0 ? own : presenceLimitsFor(landmark || {}).radiusMeters;
  return footprint + BUBBLE_MARGIN_METERS;
}
