// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { getGoogleTilesSession, googleTileUrl, googleViewportCopyright, useGoogleTiles, _resetGoogleTiles } from './googleTiles';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));
beforeEach(() => _resetGoogleTiles());

describe('google map tiles', () => {
  it('makes one satellite+labels session per page load and reuses it', async () => {
    const fetchImpl = ok({ session: 'S1', expiry: '1800000000' });
    const a = await getGoogleTilesSession({ key: 'k', fetchImpl });
    const b = await getGoogleTilesSession({ key: 'k', fetchImpl });
    expect(a).toEqual({ session: 'S1', expiry: 1800000000 });
    expect(b).toEqual(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://tile.googleapis.com/v1/createSession?key=k');
    expect(JSON.parse(init.body)).toMatchObject({ mapType: 'satellite', layerTypes: ['layerRoadmap'] });
  });
  it('no key, or a failed session, means no Google map (and a later retry)', async () => {
    expect(await getGoogleTilesSession({ key: '' })).toBeNull();
    const bad = vi.fn(async () => ({ ok: false }));
    expect(await getGoogleTilesSession({ key: 'k', fetchImpl: bad })).toBeNull();
    expect(await getGoogleTilesSession({ key: 'k', fetchImpl: ok({ session: 'S2' }) })).toMatchObject({ session: 'S2' });
  });
  it('builds tile URLs and reads the copyright line', async () => {
    expect(googleTileUrl('S', 'k')).toBe('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S&key=k');
    const fetchImpl = ok({ copyright: 'Map data ©2026 Google' });
    const text = await googleViewportCopyright('S', { north: 1, south: 0, east: 1, west: 0 }, 12.4, { key: 'k', fetchImpl });
    expect(text).toBe('Map data ©2026 Google');
    expect(fetchImpl.mock.calls[0][0]).toContain('/tile/v1/viewport?session=S&key=k&zoom=12');
    expect(await googleViewportCopyright('S', { north: 1, south: 0, east: 1, west: 0 }, 1, { key: 'k', fetchImpl: vi.fn(async () => { throw new Error('x'); }) })).toBe('');
  });
});

describe('useGoogleTiles (online Google, offline fallback)', () => {
  let state;
  function Probe({ k }) {
    state = useGoogleTiles({ key: k });
    return null;
  }
  const mount = async (k) => {
    const el = document.createElement('div');
    await act(async () => createRoot(el).render(<Probe k={k} />));
  };

  it('is Google online, falls back offline, and returns when back online', async () => {
    vi.stubGlobal('fetch', ok({ session: 'S9' }));
    await mount('k');
    await act(async () => {});
    expect(state).toMatchObject({ session: 'S9' });
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    expect(state).toBeNull();
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(state).toMatchObject({ session: 'S9' });
    // Tiles failing (bad key, quota) switches to the fallback for good.
    await act(async () => state.onTilesFailed());
    expect(state).toBeNull();
    vi.unstubAllGlobals();
  });

  it('stays on the fallback with no key', async () => {
    await mount('');
    expect(state).toBeNull();
  });
});
