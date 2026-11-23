// A spring, as Apple describes it (Designing Fluid Interfaces): `damping`
// (1 = no overshoot, lower = bouncier) and `response` (seconds to get most
// of the way there). Turned into a CSS linear() easing plus the time it
// takes to settle, for the Web Animations API.

// Progress 0 -> 1 at time t (seconds); can pass 1 when it overshoots.
export function springProgress(t, { damping = 1, response = 0.4 } = {}) {
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

// Seconds until it stays within `epsilon` of the end.
export function springDuration(params, { epsilon = 0.002, step = 1 / 120, max = 3 } = {}) {
  let settled = 0;
  for (let t = 0; t <= max; t += step) {
    if (Math.abs(1 - springProgress(t, params)) > epsilon) settled = t + step;
  }
  return Math.min(max, settled);
}

// { easing: 'linear(...)', ms } for element.animate().
export function springEasing(params, samples = 40) {
  const dur = springDuration(params);
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(i === samples ? 1 : Number(springProgress((dur * i) / samples, params).toFixed(4)));
  return { easing: `linear(${pts.join(', ')})`, ms: Math.round(dur * 1000) };
}

// Browsers without linear() get a close cubic-bezier.
export function supportsLinearEasing() {
  try {
    return typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 0.5, 1)');
  } catch {
    return false;
  }
}
