// A trip on the Map: every stop numbered in itinerary order and every leg
// (the way to a stop) drawn in its own color, so you can tell which line goes
// where. The stop's pin uses the same color as the leg that reaches it.
export const LEG_COLORS = ['#22c55e', '#4d7fff', '#f59e0b', '#ec4899', '#a855f7', '#06b6d4', '#ef4444', '#84cc16'];

// The color of the leg that reaches stop number n (1-based).
export const legColor = (n) => LEG_COLORS[(Math.max(1, n) - 1) % LEG_COLORS.length];

// Straight lines between the stops still ahead after the current one:
// dest -> queue[0] -> queue[1] ... Each carries the number and color of the
// stop it leads to. `firstNo` is the current stop's number.
export function laterLegs(dest, queue = [], firstNo = 1) {
  const legs = [];
  let from = dest;
  queue.forEach((to, i) => {
    const n = to.n ?? firstNo + i + 1;
    legs.push({ n, color: legColor(n), positions: [[from.lat, from.lng], [to.lat, to.lng]] });
    from = to;
  });
  return legs;
}
