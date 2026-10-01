// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

// `script` gets the watch callback; the plugin's watchPosition resolves to an id.
async function mount(script) {
  let watchCb;
  vi.doMock('@capacitor/geolocation', () => ({
    Geolocation: {
      getCurrentPosition: () => new Promise(() => {}),
      watchPosition: (_opts, cb) => {
        watchCb = cb;
        return Promise.resolve('w1');
      },
      clearWatch: () => {},
    },
  }));
  const { GeoProvider, useGeo } = await import('./GeoContext');
  const seen = {};
  function Probe() {
    Object.assign(seen, useGeo());
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <GeoProvider>
        <Probe />
      </GeoProvider>
    );
  });
  await act(async () => script(watchCb));
  return seen;
}

describe('GeoProvider', () => {
  it('shows a plain-language message, not the raw browser text, when permission is denied', async () => {
    const seen = await mount((cb) => cb(null, { code: 1, message: 'User denied Geolocation' }));
    expect(seen.coords).toBeNull();
    expect(seen.error).toMatch(/location is turned off/i);
    expect(seen.error).not.toMatch(/User denied/);
  });

  it('does not nag about a timeout while a good fix is already known', async () => {
    const seen = await mount((cb) => {
      cb({ coords: { latitude: 25.7, longitude: -80.2, accuracy: 10 } });
      cb(null, { code: 3, message: 'Timeout expired' });
    });
    expect(seen.coords).toMatchObject({ lat: 25.7, lng: -80.2 });
    expect(seen.error).toBeNull();
  });

  it('ignores a fix with NaN or out-of-range coordinates instead of handing it to the map', async () => {
    const seen = await mount((cb) => {
      cb({ coords: { latitude: NaN, longitude: null, accuracy: undefined } });
    });
    expect(seen.coords).toBeNull();
    expect(seen.error).toBeTruthy();
  });

  it('ignores a latitude outside -90..90', async () => {
    const seen = await mount((cb) => cb({ coords: { latitude: 400, longitude: 10, accuracy: 5 } }));
    expect(seen.coords).toBeNull();
  });
});
