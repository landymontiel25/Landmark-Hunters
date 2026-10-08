import { distanceMeters } from './geo';

// Live turn-by-turn progress along a route from api/directions.js
// ({ points: [[lat,lng]...], steps: [{ instruction, distanceMeters, end, maneuver }],
// durationSeconds, mode }). Pure functions, so the UI just feeds in each GPS fix.
//
// Google's steps describe the maneuver at the START of each step ("Turn
// right onto X", then follow X). So while you're on step i, the next thing
// to do is step i+1's instruction, at step i's end point.

const d = (a, b) => distanceMeters(a[0], a[1], b[0], b[1]);

export function prepareRoute(data) {
  const points = data?.points || [];
  // A step with no instruction (the Routes API leaves some out) just carries
  // on from the one before; as its own step it showed "Arrive at ..." as the
  // next move partway along the route. Fold it into the previous step.
  const steps = [];
  for (const s of data?.steps || []) {
    const prev = steps[steps.length - 1];
    if (prev && !s?.instruction) {
      steps[steps.length - 1] = {
        ...prev,
        distanceMeters: (prev.distanceMeters || 0) + (s?.distanceMeters || 0),
        // No end point on the folded step: fall back to the summed length.
        end: s?.end || null,
      };
    } else if (s) steps.push(s);
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum[i] = cum[i - 1] + d(points[i - 1], points[i]);
  const total = cum[cum.length - 1] || 0;

  // Each step's end as a polyline index, searching forward so the list stays in order.
  let from = 0;
  let walked = 0;
  const stepEnds = steps.map((s) => {
    walked += s.distanceMeters || 0;
    let best = from;
    if (s.end) {
      let bestD = Infinity;
      for (let j = from; j < points.length; j++) {
        const dj = d(points[j], s.end);
        if (dj < bestD) {
          bestD = dj;
          best = j;
        }
      }
    } else {
      // No end point from the server: fall back to the step's own length.
      while (best < points.length - 1 && cum[best] < walked) best++;
    }
    from = best;
    return best;
  });
  if (stepEnds.length) stepEnds[stepEnds.length - 1] = Math.max(0, points.length - 1);
  return { points, steps, cum, total, stepEnds, durationSeconds: data?.durationSeconds || 0, mode: data?.mode };
}

// Nearest point on the route to `pos` ({lat,lng}), as distance along the
// route and how far off it you are. `hintAlong` (your last position along
// it) keeps a route that doubles back from snapping you to the wrong pass.
export function snapToRoute(route, pos, hintAlong = 0) {
  const { points, cum } = route;
  if (points.length < 2) return { along: 0, offset: points.length ? d(points[0], [pos.lat, pos.lng]) : Infinity };
  // Local flat projection (meters) around the position -- plenty accurate for a few km.
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 110540;
  const px = pos.lng * kx;
  const py = pos.lat * ky;
  let best = { along: 0, offset: Infinity, score: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i][1] * kx;
    const ay = points[i][0] * ky;
    const bx = points[i + 1][1] * kx;
    const by = points[i + 1][0] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const offset = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    // Going backwards along the route is unlikely -- a small penalty.
    const score = offset + (along < hintAlong - 50 ? 40 : 0);
    if (score < best.score) best = { along, offset, score };
  }
  return { along: best.along, offset: best.offset };
}

const OFF_ROUTE_METERS = { WALK: 35, DRIVE: 60 };
const ARRIVE_METERS = 30;

/**
 * Where you are on the route right now:
 * { along, offset, offRoute, arrived, stepIndex, next: { instruction, maneuver } | null,
 *   metersToNext, remainingMeters, remainingSeconds }
 */
export function navProgress(route, pos, hintAlong = 0) {
  const { along, offset } = snapToRoute(route, pos, hintAlong);
  const { steps, stepEnds, cum, total, points } = route;
  const accuracy = Number.isFinite(pos.accuracy) ? pos.accuracy : 0;
  const offRoute = offset > Math.max(OFF_ROUTE_METERS[route.mode] || 50, accuracy * 1.2);
  const remainingMeters = Math.max(0, total - along);
  const last = points[points.length - 1];
  const arrived = !!last && (d(last, [pos.lat, pos.lng]) <= ARRIVE_METERS || remainingMeters <= ARRIVE_METERS / 2);

  let stepIndex = stepEnds.findIndex((e) => cum[e] > along + 5);
  if (stepIndex === -1) stepIndex = Math.max(0, steps.length - 1);
  const nextStep = steps[stepIndex + 1] || null;
  const metersToNext = Math.max(0, (cum[stepEnds[stepIndex]] ?? total) - along);
  const remainingSeconds = total ? Math.round((route.durationSeconds * remainingMeters) / total) : 0;
  return {
    along,
    offset,
    offRoute,
    arrived,
    stepIndex,
    next: nextStep ? { instruction: nextStep.instruction, maneuver: nextStep.maneuver } : null,
    metersToNext,
    remainingMeters,
    remainingSeconds,
  };
}

// Arrow for a Routes API maneuver (TURN_LEFT, RAMP_RIGHT, ...).
export function maneuverIcon(maneuver) {
  const m = String(maneuver || '');
  if (m.includes('UTURN')) return '\u{21A9}\u{FE0F}';
  if (m.includes('ROUNDABOUT')) return '\u{1F504}';
  if (m.includes('SHARP_LEFT') || m === 'TURN_LEFT' || m === 'RAMP_LEFT' || m === 'FORK_LEFT') return '\u{2B05}\u{FE0F}';
  if (m.includes('SHARP_RIGHT') || m === 'TURN_RIGHT' || m === 'RAMP_RIGHT' || m === 'FORK_RIGHT') return '\u{27A1}\u{FE0F}';
  if (m.includes('SLIGHT_LEFT') || (m.includes('MERGE') && m.includes('LEFT'))) return '\u{2196}\u{FE0F}';
  if (m.includes('SLIGHT_RIGHT') || (m.includes('MERGE') && m.includes('RIGHT'))) return '\u{2197}\u{FE0F}';
  if (m.includes('FERRY')) return '\u{26F4}\u{FE0F}';
  return '\u{2B06}\u{FE0F}';
}
