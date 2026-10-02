// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

const loadPlacePhoto = vi.fn(async () => ({ url: 'https://lh3.googleusercontent.com/p', attributions: [{ name: 'Jane' }] }));
vi.mock('../lib/placePhoto', () => ({
  placePhotoKey: (l) => (l?.name ? `${l.name}|${l.lat}|${l.lng}` : null),
  peekPlacePhoto: () => undefined,
  loadPlacePhoto: (...a) => loadPlacePhoto(...a),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import LandmarkPostcard, { CommonsCredit } from './LandmarkPostcard';

let container;
afterEach(() => document.body.removeChild(container));

describe('LandmarkPostcard', () => {
  it('keeps the active dot in range when the last photo fails to load', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const lm = { id: 'x', name: 'X', categories: [], images: ['a.jpg', 'b.jpg', 'c.jpg'] };
    await act(async () => createRoot(container).render(<LandmarkPostcard landmark={lm} swipeable />));
    const scroll = container.querySelector('.postcard-gallery-scroll');
    Object.defineProperty(scroll, 'clientWidth', { value: 100, configurable: true });
    scroll.scrollLeft = 200;
    await act(async () => scroll.dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(container.querySelectorAll('.postcard-gallery-dot')[2].className).toContain('active');
    await act(async () => container.querySelectorAll('img')[2].dispatchEvent(new Event('error')));
    const dots = container.querySelectorAll('.postcard-gallery-dot');
    expect(dots).toHaveLength(2);
    expect([...dots].filter((d) => d.className.includes('active'))).toHaveLength(1);
  });

  it('falls back to a Google photo when its only stored photo fails to load', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const lm = { id: 'x', name: 'X', lat: 1, lng: 2, categories: [], images: ['dead.jpg'] };
    await act(async () => createRoot(container).render(<LandmarkPostcard landmark={lm} />));
    expect(container.querySelector('img').getAttribute('src')).toBe('dead.jpg');
    expect(loadPlacePhoto).not.toHaveBeenCalled();
    await act(async () => container.querySelector('img').dispatchEvent(new Event('error')));
    await act(async () => {});
    expect(loadPlacePhoto).toHaveBeenCalled();
    expect(container.querySelector('img').getAttribute('src')).toBe('https://lh3.googleusercontent.com/p');
  });

  it('shows the author and license credit for a Commons photo, linked to its page and terms', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const credit = { author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', pageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg' };
    await act(async () => createRoot(container).render(<CommonsCredit credit={credit} />));
    const links = [...container.querySelectorAll('a')];
    expect(container.textContent).toBe('Photo: Jane Doe, CC BY-SA 4.0');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([credit.pageUrl, credit.licenseUrl]);
  });
});
