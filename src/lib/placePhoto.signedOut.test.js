import { describe, it, expect, vi } from 'vitest';

// Signed out: no Authorization header at all.
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));
vi.mock('./communityPhotos', () => ({ getCommunityPhoto: async () => null }));
const calls = [];
vi.mock('./friendlyError', () => ({
  fetchJson: async (url, init) => {
    calls.push({ url, init });
    return { url: 'https://photo.example/x.jpg', attributions: [] };
  },
}));

describe('placePhoto signed out (owner, 2026-11-16)', () => {
  it("still asks for Google's photo, with no sign-in header", async () => {
    const { loadPlacePhoto } = await import('./placePhoto');
    const photo = await loadPlacePhoto({ id: 'zoo-miami', region: 'miami', name: 'Zoo Miami', lat: 25.61, lng: -80.4 });
    expect(photo).toEqual({ url: 'https://photo.example/x.jpg', attributions: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });
});
