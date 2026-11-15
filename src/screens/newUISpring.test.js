// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Spring, VelocityTracker, project, rubberband } from './newUISpring';

// Drive requestAnimationFrame by hand, 60 frames a second.
function frames() {
  let now = 0;
  const queue = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => queue.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => queue.splice(0));
  return (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      const run = queue.splice(0);
      for (const fn of run) fn(now);
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('newUISpring', () => {
  it('a critically damped spring settles on the target without overshoot', () => {
    const tick = frames();
    const seen = [];
    const s = new Spring(0, (v) => seen.push(v));
    const done = vi.fn();
    s.to(100, { damping: 1, response: 0.4, done });
    tick(120);
    expect(done).toHaveBeenCalledOnce();
    expect(s.value).toBe(100);
    expect(Math.max(...seen)).toBeLessThanOrEqual(100.01);
  });

  it('bounce only below damping 1', () => {
    const tick = frames();
    const seen = [];
    const s = new Spring(0, (v) => seen.push(v));
    s.to(100, { damping: 0.6, response: 0.3 });
    tick(120);
    expect(Math.max(...seen)).toBeGreaterThan(101);
  });

  it('retargeting mid-flight starts from where it is, keeps its velocity, and only the last done() runs', () => {
    const tick = frames();
    const s = new Spring(0, () => {});
    const first = vi.fn();
    const second = vi.fn();
    s.to(100, { done: first });
    tick(8);
    const here = s.value;
    const speed = s.velocity;
    expect(here).toBeGreaterThan(0);
    expect(here).toBeLessThan(100);
    expect(speed).toBeGreaterThan(0);
    s.to(0, { done: second });
    tick(1);
    // No jump: one frame on from where it was, still carrying its speed.
    expect(Math.abs(s.value - here)).toBeLessThan(speed / 30);
    tick(200);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(s.value).toBe(0);
  });

  it('set() follows the finger 1:1 and stops any motion', () => {
    const tick = frames();
    const onChange = vi.fn();
    const s = new Spring(0, onChange);
    const done = vi.fn();
    s.to(100, { done });
    tick(3);
    s.set(42);
    tick(50);
    expect(s.value).toBe(42);
    expect(done).not.toHaveBeenCalled();
  });

  it('with Reduce Motion the spring lands at once', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('reduce') }));
    window.matchMedia = globalThis.matchMedia;
    const s = new Spring(0, () => {});
    const done = vi.fn();
    s.to(50, { done });
    expect(s.value).toBe(50);
    expect(done).toHaveBeenCalledOnce();
    delete window.matchMedia;
  });

  it("projects a flick's landing point and rubber-bands past an edge", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
    const r = rubberband(200, 600);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(200);
    expect(rubberband(400, 600) - rubberband(200, 600)).toBeLessThan(r);
  });

  it('measures pointer speed over the last moves', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(10, 0, 20);
    v.add(30, 5, 40);
    expect(v.get().x).toBeCloseTo(750);
    expect(v.get().y).toBeCloseTo(125);
  });
});
