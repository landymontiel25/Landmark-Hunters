// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  fav: {
    favorites: [
      { region: 'miami', id: 'vizcaya', name: 'Vizcaya', lat: 25.7, lng: -80.2, note: 'Go at sunset', savedAt: 2 },
      { region: 'rome', id: 'pizzeria-x', name: 'Pizzeria X', lat: 41.9, lng: 12.5, note: 'Great pizza, ask for the garlic knots', savedAt: 3 },
    ],
    ready: true,
    signedIn: true,
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setNote: vi.fn(async () => {}),
  },
  toast: { show: vi.fn() },
}));
vi.mock('../lib/FavoritesContext', () => ({ useFavorites: () => h.fav }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => h.toast }));
vi.mock('../components/DirectionsButton', () => ({ default: ({ children }) => <button type="button">{children}</button> }));

import FavoritesList from './FavoritesList';

let container;
afterEach(() => container?.remove());
async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <FavoritesList />
      </MemoryRouter>
    )
  );
}
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('Favorites list', () => {
  it('lists each place with your note, grouped by city, and searches notes', async () => {
    await render();
    expect(container.textContent).toContain('Vizcaya');
    expect(container.textContent).toContain('Go at sunset');
    expect(container.textContent).toContain('Great pizza, ask for the garlic knots');
    const box = container.querySelector('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'garlic');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Pizzeria X');
    expect(container.textContent).not.toContain('Vizcaya');
  });

  it('filters by city and sorts A to Z', async () => {
    await render();
    const select = container.querySelector('select[aria-label="Filter by city"]');
    expect([...select.options].map((o) => o.textContent)).toEqual(['All cities (2)', 'Miami (1)', 'Other places (1)']);
    await act(async () => {
      select.value = 'Miami';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Vizcaya');
    expect(container.textContent).not.toContain('Pizzeria X');
  });

  it('edits a note and removes a place with Undo', async () => {
    await render();
    await act(async () => button('Edit note').click());
    const box = container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'New note');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save note').click());
    expect(h.fav.setNote).toHaveBeenCalledTimes(1);
    expect(h.fav.setNote.mock.calls[0][2]).toBe('New note');
    await act(async () => container.querySelector('button[aria-label^="Remove"]').click());
    expect(h.fav.remove).toHaveBeenCalledTimes(1);
    expect(h.toast.show).toHaveBeenCalledWith(expect.stringContaining('Removed'), expect.objectContaining({ actionLabel: 'Undo' }));
  });

  it('asks you to sign in when signed out', async () => {
    h.fav.signedIn = false;
    await render();
    expect(container.textContent).toContain('Sign in');
    h.fav.signedIn = true;
  });
});
