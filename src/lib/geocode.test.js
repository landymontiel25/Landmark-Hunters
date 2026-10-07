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
