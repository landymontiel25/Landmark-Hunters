// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const photoCalls = [];
vi.mock('../lib/usePlacePhoto', () => ({
  usePlacePhoto: (landmark, opts) => {
    photoCalls.push({ id: landmark.id, opts });
    return { photo: null };
  },
}));

import LandmarkThumb from './LandmarkThumb';

describe('LandmarkThumb', () => {
  it('falls through to the next image when the first fails', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const landmark = { id: 'x', name: 'X', categories: [], images: ['a.jpg', 'b.jpg'] };
    await act(async () => root.render(<LandmarkThumb landmark={landmark} />));
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toBe('a.jpg');
    await act(async () => img.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('b.jpg');
  });

  it('an imported place with no photo looks one up in a list, before it is opened (owner, 2026-11-08)', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const landmark = { id: 'osm-w1', name: 'Imported', source: 'osm', categories: [], images: [] };
    await act(async () => root.render(<LandmarkThumb landmark={landmark} />));
    const call = photoCalls.filter((c) => c.id === 'osm-w1').at(-1);
    expect(call.opts.enabled).toBe(true);
    expect(call.opts.lookup).not.toBe(false);
  });
});
