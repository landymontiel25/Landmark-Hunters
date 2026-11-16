import { describe, it, expect } from 'vitest';
import { labelSides, untangledRoute } from './untangleRoute';

// Official Onboarding's intro day (owner, 2026-11-15): 1 South Beach,
// 2 News Café, 3 Colony Hotel. Colony sits right beside the straight line
// from South Beach to News Café.
const SOUTH_BEACH = [25.774429, -80.133241];
const NEWS_CAFE = [25.778133, -80.131445];
const COLONY = [25.77747, -80.131593];
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 111000 * Math.cos((a[0] * Math.PI) / 180));
// The closest a stretch of route comes to a point, in meters.
const closest = (pts, p) => Math.min(...pts.map((q) => dist(q, p)));

describe('untangledRoute', () => {
  it('goes 1, then 2, then 3, and the leg to 2 bends well clear of 3', () => {
    const line = untangledRoute([SOUTH_BEACH, NEWS_CAFE, COLONY]);
    expect(line[0]).toEqual(SOUTH_BEACH);
    expect(line[16]).toEqual(NEWS_CAFE);
    expect(line[line.length - 1]).toEqual(COLONY);
    const straight = Array.from({ length: 17 }, (_, t) => [SOUTH_BEACH[0] + ((NEWS_CAFE[0] - SOUTH_BEACH[0]) * t) / 16, SOUTH_BEACH[1] + ((NEWS_CAFE[1] - SOUTH_BEACH[1]) * t) / 16]);
    // Before it arrives at News Café (which is itself ~75 m from Colony),
    // the route keeps well clear of pin 3: at least twice as far as the
    // straight line did, and more than a pin's width on screen.
    const approach = line.slice(0, 13);
    const before = closest(straight.slice(0, 13), COLONY);
    const after = closest(approach, COLONY);
    expect(after).toBeGreaterThan(before * 2);
    expect(after).toBeGreaterThan(80);
  });

  it('keeps two stops as they are', () => {
    expect(untangledRoute([SOUTH_BEACH])).toEqual([SOUTH_BEACH]);
    expect(untangledRoute([SOUTH_BEACH, NEWS_CAFE])).toHaveLength(17);
  });
});

describe('labelSides', () => {
  it("puts each name on the side away from its nearest stop, so 2's and 3's never stack", () => {
    const [one, two, three] = labelSides([SOUTH_BEACH, NEWS_CAFE, COLONY]);
    expect(two).not.toBe(three);
    expect(two).toBe('right');
    expect(three).toBe('left');
    expect(one).toBe('left');
  });
});

describe('spreadPoints', () => {
  it('moves two stops 70 m apart until their pins clear, keeps the order, and leaves the far one alone', async () => {
    const { spreadPoints, CLOSE_M } = await import('./untangleRoute');
    const [one, two, three] = spreadPoints([SOUTH_BEACH, NEWS_CAFE, COLONY]);
    expect(one).toEqual(SOUTH_BEACH);
    expect(dist(two, three)).toBeGreaterThan(CLOSE_M - 1);
    // Each moved only half the gap, along the line between them.
    expect(dist(two, NEWS_CAFE)).toBeLessThan(45);
    expect(dist(three, COLONY)).toBeLessThan(45);
    expect(two[0]).toBeGreaterThan(three[0]);
  });

  it('the dotted route starts and ends exactly on the pins it joins (owner, 2026-11-16)', async () => {
    const { spreadPoints } = await import('./untangleRoute');
    const pins = spreadPoints([SOUTH_BEACH, NEWS_CAFE, COLONY]);
    const line = untangledRoute(pins);
    expect(line[0]).toEqual(pins[0]);
    expect(line[16]).toEqual(pins[1]);
    expect(line[32]).toEqual(pins[2]);
  });
});
