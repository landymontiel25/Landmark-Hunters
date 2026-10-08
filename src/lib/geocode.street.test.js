// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('streetAddress', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  it('sends one request per point, spaced a second apart, and skips a point that just failed', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push([url, Date.now()]);
      const ok = !String(url).includes('lat=9');
      return { ok, json: async () => ({ address: { road: 'Main St', city: 'Town' } }) };
    });
    const { streetAddress } = await import('./geocode');
    const [a, b, c] = await Promise.all([streetAddress(1, 1), streetAddress(1, 1), streetAddress(2, 2)]);
    expect(a).toBe('Main St, Town');
    expect(b).toBe('Main St, Town');
    expect(c).toBe('Main St, Town');
    expect(calls.length).toBe(2);
    expect(calls[1][1] - calls[0][1]).toBeGreaterThanOrEqual(1000);
    expect(await streetAddress(9, 9)).toBe(null);
    expect(await streetAddress(9, 9)).toBe(null);
    expect(calls.length).toBe(3);
  }, 10000);
});
