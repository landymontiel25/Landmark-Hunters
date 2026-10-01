// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));

import LandmarkThumb from '../components/LandmarkThumb';
import { loadPlacePhoto, resetPlacePhotoCache } from './placePhoto';

let container;
let observers;
let fetchMock;

class FakeIO {
  constructor(cb) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el) {
    this.el = el;
  }
  disconnect() {
    this.gone = true;
  }
  fire() {
    this.cb([{ isIntersecting: true, target: this.el }]);
  }
}

const PHOTO = { url: 'https://lh3.googleusercontent.com/p', attributions: [{ name: 'Jane Doe', uri: 'https://maps.google.com/maps/contrib/1' }] };
const lm = (over = {}) => ({ id: 'a', name: 'Cafe A', lat: 40, lng: -75, categories: [], images: [], ...over });

const render = async (ui) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(ui));
};
const reveal = async () => {
  await act(async () => observers.filter((o) => !o.gone).forEach((o) => o.fire()));
  await act(async () => {});
};

beforeEach(() => {
  observers = [];
  resetPlacePhotoCache();
  globalThis.IntersectionObserver = FakeIO;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => PHOTO }));
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  if (container?.parentNode) container.parentNode.removeChild(container);
  container = null;
});

describe('LandmarkThumb Google photo fallback', () => {
  it('does not fetch until the tile is visible, then shows the photo with credit', async () => {
    await render(<LandmarkThumb landmark={lm()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('.landmark-thumb-fallback')).toBeTruthy();
    await reveal();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/place-photo?name=Cafe+A&lat=40&lng=-75');
    expect(container.querySelector('img').getAttribute('src')).toBe(PHOTO.url);
    const credit = container.querySelector('.place-photo-credit');
    expect(credit.getAttribute('title')).toBe('Photo: Jane Doe via Google Maps');
    expect(credit.getAttribute('href')).toBe('https://maps.google.com/maps/contrib/1');
  });

  it('shows the full credit text on large tiles', async () => {
    await render(<LandmarkThumb landmark={lm()} width={228} height={110} />);
    await reveal();
    expect(container.querySelector('.place-photo-credit').textContent).toBe('Photo: Jane Doe via Google Maps');
    expect(container.querySelector('.place-photo-credit a').getAttribute('href')).toBe('https://maps.google.com/maps/contrib/1');
  });

  it('never fetches when the landmark already has an image or a personal photo', async () => {
    await render(<LandmarkThumb landmark={lm({ images: ['https://x/y.jpg'] })} />);
    await reveal();
    expect(observers).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    container.remove();
    await render(<LandmarkThumb landmark={lm()} myPhoto="https://x/mine.jpg" />);
    await reveal();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the placeholder on failure, and on a no-match answer', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'x' }) });
    await render(<LandmarkThumb landmark={lm()} />);
    await reveal();
    expect(container.querySelector('.landmark-thumb-fallback')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();

    container.remove();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: null, attributions: [] }) });
    await render(<LandmarkThumb landmark={lm({ id: 'b', name: 'Other', lat: 41 })} />);
    await reveal();
    expect(container.querySelector('.landmark-thumb-fallback')).toBeTruthy();
  });

  it('falls back to the placeholder when the photo URL fails to load', async () => {
    await render(<LandmarkThumb landmark={lm()} />);
    await reveal();
    await act(async () => container.querySelector('img').dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.landmark-thumb-fallback')).toBeTruthy();
  });

  it('dedupes: many tiles of the same landmark make one request', async () => {
    await render(
      <div>
        <LandmarkThumb landmark={lm()} />
        <LandmarkThumb landmark={lm()} />
        <LandmarkThumb landmark={lm()} />
      </div>
    );
    await reveal();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('img')).toHaveLength(3);
  });

  it('skips landmarks without coordinates', async () => {
    await render(<LandmarkThumb landmark={lm({ lat: undefined })} />);
    await reveal();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('loadPlacePhoto', () => {
  it('limits concurrency to 3 requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const resolvers = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve({ ok: true, status: 200, json: async () => PHOTO });
          });
        })
    );
    const all = Array.from({ length: 8 }, (_, i) => loadPlacePhoto(lm({ name: `P${i}` })));
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
      while (resolvers.length) resolvers.shift()();
    }
    await Promise.all(all);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('pauses all requests after a rate-limit response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'slow' }) });
    expect(await loadPlacePhoto(lm({ name: 'R1' }))).toBeNull();
    expect(await loadPlacePhoto(lm({ name: 'R2' }))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
