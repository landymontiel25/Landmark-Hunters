import { describe, it, expect } from 'vitest';
import { springProgress, springDuration, springEasing } from './spring';

describe('spring', () => {
  it('starts at 0, ends at 1, and only overshoots when underdamped', () => {
    expect(springProgress(0, { damping: 1, response: 0.4 })).toBeCloseTo(0, 5);
    expect(springProgress(3, { damping: 1, response: 0.4 })).toBeCloseTo(1, 3);
    const peak = (p) => Math.max(...Array.from({ length: 300 }, (_, i) => springProgress(i / 100, p)));
    expect(peak({ damping: 1, response: 0.4 })).toBeLessThanOrEqual(1.0001);
    expect(peak({ damping: 0.6, response: 0.5 })).toBeGreaterThan(1.05);
  });
  it('makes a linear() easing that ends exactly at 1, with a settle time', () => {
    const { easing, ms } = springEasing({ damping: 0.6, response: 0.5 });
    expect(easing).toMatch(/^linear\(0, /);
    expect(easing.endsWith(', 1)')).toBe(true);
    expect(ms).toBeGreaterThan(300);
    expect(ms).toBeLessThan(3000);
    expect(springDuration({ damping: 1, response: 0.35 })).toBeLessThan(springDuration({ damping: 0.6, response: 0.5 }));
  });
});
