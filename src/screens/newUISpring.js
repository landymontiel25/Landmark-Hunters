// Springs for the Test tab's New UI, in Apple's terms (WWDC 2018,
// "Designing Fluid Interfaces"): a damping ratio (1 = no overshoot) and a
// response in seconds. A spring always starts from where the value is on
// screen right now and keeps its velocity, so any motion can be grabbed
// and reversed mid-flight. No library: the live app's bundle is unchanged.

// Apple's presets. Bounce (damping < 1) only after a flick.
export const SPRING = {
  move: { damping: 1, response: 0.4 },
  push: { damping: 1, response: 0.38 },
  tab: { damping: 1, response: 0.32 },
  sheet: { damping: 1, response: 0.34 },
  sheetFlick: { damping: 0.8, response: 0.3 },
};

// Where a flick comes to rest, the way scroll views decelerate (Apple's
// sample code). velocity in px/s.
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Soft resistance past an edge, instead of a hard stop.
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16));
const caf = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

// One animated number. onChange runs every frame with the current value;
// write it straight to a style, not to React state.
export class Spring {
  constructor(value, onChange) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
    this.onChange = onChange;
    this.frame = null;
    this.done = null;
  }

  // Follow the finger 1:1: no animation, and anything running stops.
  set(value) {
    this.stop();
    this.value = value;
    this.target = value;
    this.onChange?.(value);
  }

  stop() {
    if (this.frame != null) caf(this.frame);
    this.frame = null;
    this.done = null;
  }

  // Spring to a target from the current value and velocity. A new to()
  // retargets the running motion without a jump; only the latest done()
  // runs. velocity (units/s) hands a gesture's speed to the spring.
  to(target, { damping = 1, response = 0.4, velocity, done } = {}) {
    if (this.frame != null) caf(this.frame);
    this.frame = null;
    this.target = target;
    this.done = done || null;
    if (velocity != null) this.velocity = velocity;
    if (prefersReducedMotion()) {
      this.velocity = 0;
      this.value = target;
      this.onChange?.(target);
      this.finish();
      return;
    }
    // Mass 1: stiffness from the period, damping from the ratio.
    const k = (2 * Math.PI / response) ** 2;
    const c = (4 * Math.PI * damping) / response;
    let last = null;
    const step = (now) => {
      const dt = last == null ? 1 / 60 : Math.min(0.064, (now - last) / 1000);
      last = now;
      // Small fixed substeps keep stiff springs stable on slow frames.
      const n = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = -k * (this.value - this.target) - c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
      const span = Math.max(1, Math.abs(this.target)) * 1e-4;
      if (Math.abs(this.velocity) < span * 10 && Math.abs(this.value - this.target) < span) {
        this.value = this.target;
        this.velocity = 0;
        this.onChange?.(this.value);
        this.frame = null;
        this.finish();
        return;
      }
      this.onChange?.(this.value);
      this.frame = raf(step);
    };
    this.frame = raf(step);
  }

  finish() {
    const d = this.done;
    this.done = null;
    d?.();
  }
}

// Pointer velocity from the last ~100 ms of moves, in px/s.
export class VelocityTracker {
  constructor() {
    this.samples = [];
  }

  add(x, y, t = performance.now()) {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }

  get() {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
}
