import { isMallPlace } from '../malls.js';

// Owner, 2026-11-04: in Miami, malls go all the way to the bottom of every
// ranked list, whatever their rating or review count. Nobody should be sent
// to Dolphin Mall as the first thing to do. Malls stay in the list (a
// shopping search still finds them); they just come after every other place.
// The regions this applies to; add an id here to extend it.
export const MALLS_LAST_REGIONS = new Set(['miami']);

export const sinksToBottom = (l) => !!l && isMallPlace(l) && MALLS_LAST_REGIONS.has(l.regionId || l.region);

// Stable: both groups keep the order they came in. Returns the same array
// when no mall is in it.
export function mallsLast(places) {
  if (!places.some(sinksToBottom)) return places;
  return [...places.filter((l) => !sinksToBottom(l)), ...places.filter(sinksToBottom)];
}
