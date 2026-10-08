// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/usePlacePhoto', () => ({ usePlacePhoto: () => ({ photo: null }) }));

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
});
