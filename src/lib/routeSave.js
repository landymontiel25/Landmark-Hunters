// The Map's route editor writes its order back to the itinerary (owner,
// 2026-11-23). `full`: the itinerary's whole order; `routeStopIds`: the stops
// the route opened with; `kept`: the route now, in its new order. The route
// stops take the slots they had in the itinerary, in the new order, with any
// dropped from the route right after the kept ones (dropping a stop from the
// route never takes it off the itinerary). Stops that weren't on the route
// (visited ones, say) don't move.
export function mergeRouteOrder(full, routeStopIds, kept) {
  const onRoute = new Set(routeStopIds);
  const inFull = new Set(full);
  const dropped = routeStopIds.filter((id) => !kept.includes(id));
  const seq = [...kept, ...dropped].filter((id) => inFull.has(id));
  let i = 0;
  return full.map((id) => (onRoute.has(id) ? seq[i++] ?? id : id));
}

export const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
