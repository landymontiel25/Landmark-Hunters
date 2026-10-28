// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ community: null }));
vi.mock('./communityPhotos', () => ({ getCommunityPhoto: async () => h.community }));
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));

import { loadPlacePhoto, resetPlacePhotoCache, forgetPlacePhoto } from './placePhoto';

const lm = { id: 'pl-1', region: 'miami', name: 'Cafe A', lat: 25.1, lng: -80.2 };
let fetchMock;
beforeEach(() => {
  resetPlacePhotoCache();
  h.community = null;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://g/p', attributions: [{ name: 'J' }] }) }));
  globalThis.fetch = fetchMock;
});

describe('place photo order', () => {
  it('a shared community photo wins and Google is never asked', async () => {
    h.community = { url: 'https://firebasestorage.googleapis.com/x.jpg', photoUid: 'ann' };
    const p = await loadPlacePhoto(lm);
    expect(p).toEqual({ url: 'https://firebasestorage.googleapis.com/x.jpg', attributions: [], community: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with none shared it falls through to Google, and forgetting drops the cached one', async () => {
    const p = await loadPlacePhoto(lm);
    expect(p.url).toBe('https://g/p');
    expect(p.community).toBeUndefined();
    h.community = { url: 'https://firebasestorage.googleapis.com/y.jpg', photoUid: 'bob' };
    forgetPlacePhoto(lm);
    expect((await loadPlacePhoto(lm)).community).toBe(true);
  });
});
