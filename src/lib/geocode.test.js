import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodeLocation, GEOCODE_TIMEOUT_MS } from './geocode';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('geocodeLocation', () => {
  it('gives up on a hung lookup and falls back to the region center', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      )
    );
    const center = { lat: 1, lng: 2 };
    const p = geocodeLocation('somewhere', { center });
    await vi.advanceTimersByTimeAsync(GEOCODE_TIMEOUT_MS);
    await expect(p).resolves.toEqual(center);
  });
});

describe('withStreetEntry', () => {
  it('keeps the street cache to the newest STREET_CACHE_LIMIT entries', async () => {
    const { withStreetEntry, STREET_CACHE_LIMIT } = await import('./geocode');
    let cache = {};
    for (let i = 0; i < STREET_CACHE_LIMIT + 50; i++) cache = withStreetEntry(cache, `40.${i},-75.0`, `addr ${i}`);
    const keys = Object.keys(cache);
    expect(keys).toHaveLength(STREET_CACHE_LIMIT);
    expect(cache['40.0,-75.0']).toBeUndefined();
    expect(cache[`40.${STREET_CACHE_LIMIT + 49},-75.0`]).toBe(`addr ${STREET_CACHE_LIMIT + 49}`);
  });
});
