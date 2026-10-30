import { presenceLimitsFor } from './presence';

// The bubble drawn on the Map when you tap a landmark (like Life360's place
// circles): the landmark's own footprint plus a margin on every side.
// The footprint is the place's own `footprintMeters` when it sets one, else
// the radius for its kind of place (presence.js: 30 m landmark, 60 m indoor,
// 150 m park or district). The check-in radius is NOT used: it is generous on
// purpose (Stoneleigh's is 700 m) and made the bubble far too big.
export const BUBBLE_MARGIN_METERS = 30;

export function bubbleRadius(landmark) {
  const own = landmark?.footprintMeters;
  const footprint = Number.isFinite(own) && own > 0 ? own : presenceLimitsFor(landmark || {}).radiusMeters;
  return footprint + BUBBLE_MARGIN_METERS;
}
