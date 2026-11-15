// Official Onboarding's route map (RouteMap's untangle, owner 2026-11-15):
// a route through stops close together, bent so it reads in order, and which
// side of its pin each name goes on. See RouteMap in ExplainerImagesLab.jsx.
const toXY = ([lat, lng], k) => [lng * k, lat];
const toLatLng = ([x, y], k) => [y, x / k];
export function untangledRoute(points) {
  if (points.length < 2) return points;
  const k = Math.cos((points[0][0] * Math.PI) / 180);
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1], k);
    const b = toXY(points[i], k);
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [-dy / len, dx / len];
    // Which side are the stops this leg doesn't touch on? Bend the other way.
    const others = points.filter((_, j) => j !== i && j !== i - 1).map((p) => toXY(p, k));
    const side = others.reduce((sum, p) => sum + Math.sign((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) / (1 + Math.hypot(p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2) / len), 0);
    const bend = side === 0 ? 0.12 * (i % 2 ? 1 : -1) : -0.55 * Math.sign(side);
    const c = [(a[0] + b[0]) / 2 + nx * len * bend, (a[1] + b[1]) / 2 + ny * len * bend];
    for (let t = 1; t <= 16; t++) {
      const u = t / 16;
      const x = (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0];
      const y = (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1];
      out.push(toLatLng([x, y], k));
    }
  }
  return out;
}
// The side each name goes on: away from the nearest other stop.
export function labelSides(points) {
  return points.map((p, i) => {
    let best = null;
    points.forEach((q, j) => {
      if (j === i) return;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { d, q };
    });
    return best && best.q[1] > p[1] ? 'left' : 'right';
  });
}

// Pins closer than this (meters) would sit on top of each other at the
// map's zoom; the northern one is nudged up and the southern one down.
const CLOSE_M = 140;
export const PIN_NUDGE_PX = 24;
export function pinNudges(points) {
  const dy = points.map(() => 0);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const [a, b] = [points[i], points[j]];
      const m = Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 111000 * Math.cos((a[0] * Math.PI) / 180));
      if (m >= CLOSE_M) continue;
      const north = a[0] >= b[0] ? i : j;
      const south = north === i ? j : i;
      dy[north] = -PIN_NUDGE_PX;
      dy[south] = PIN_NUDGE_PX;
    }
  return dy;
}
