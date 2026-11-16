import { describe, it, expect, vi, beforeEach } from 'vitest';

let status = 200;
const calls = [];
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));
vi.mock('./communityPhotos', () => ({ getCommunityPhoto: async () => null }));
vi.mock('./friendlyError', () => ({
  fetchJson: async (url) => {
    calls.push(url);
    if (status !== 200) throw Object.assign(new Error('x'), { status });
    return { url: 'https://photo.example/x.jpg', attributions: [] };
  },
}));

const place = (n) => ({ id: `p${n}`, region: 'miami', name: `Place ${n}`, lat: 25.7 + n / 1000, lng: -80.2 });

beforeEach(async () => {
  calls.length = 0;
  status = 200;
  (await import('./placePhoto')).resetPlacePhotoCache();
});

describe('placePhoto (owner, 2026-11-16)', () => {
  it("prefetches a page's photos once, and skips places with their own", async () => {
    const { prefetchPlacePhotos, loadPlacePhoto } = await import('./placePhoto');
    prefetchPlacePhotos([place(1), place(2), { ...place(3), images: ['own.jpg'] }]);
    await loadPlacePhoto(place(2));
    prefetchPlacePhotos([place(1), place(2)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
  });

  it('after a rate limit, asks again once the pause ends instead of keeping "no photo" for 5 minutes', async () => {
    vi.useFakeTimers();
    const { loadPlacePhoto, placePhotoRetryInMs, peekPlacePhoto } = await import('./placePhoto');
    status = 429;
    expect(await loadPlacePhoto(place(5))).toBeNull();
    const wait = placePhotoRetryInMs();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60000);
    status = 200;
    vi.advanceTimersByTime(wait + 1000);
    expect(peekPlacePhoto(place(5))).toBeUndefined();
    expect(await loadPlacePhoto(place(5))).toEqual({ url: 'https://photo.example/x.jpg', attributions: [] });
    vi.useRealTimers();
  });
});
