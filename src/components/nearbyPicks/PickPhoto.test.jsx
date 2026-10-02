// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const loadPlacePhoto = vi.fn(async () => ({ url: 'https://lh3.googleusercontent.com/p', attributions: [{ name: 'Jane' }] }));
vi.mock('../../lib/placePhoto', () => ({
  placePhotoKey: (l) => (l?.name ? `${l.name}|${l.lat}|${l.lng}` : null),
  peekPlacePhoto: () => undefined,
  loadPlacePhoto: (...a) => loadPlacePhoto(...a),
}));

const { PickPhoto } = await import('./PickCard');

let container;
afterEach(() => document.body.removeChild(container));

describe('PickPhoto', () => {
  it('falls back to a Google photo when the stored image fails to load', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const pick = { id: 'p', name: 'Place', lat: 1, lng: 2, categories: [], image: 'dead.jpg' };
    await act(async () => createRoot(container).render(<MemoryRouter><PickPhoto pick={pick} className="x" /></MemoryRouter>));
    expect(loadPlacePhoto).not.toHaveBeenCalled();
    await act(async () => container.querySelector('img').dispatchEvent(new Event('error')));
    await act(async () => {});
    expect(loadPlacePhoto).toHaveBeenCalled();
    expect(container.querySelector('img').getAttribute('src')).toBe('https://lh3.googleusercontent.com/p');
  });
});
