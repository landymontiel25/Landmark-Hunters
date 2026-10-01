// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import LandmarkPostcard from './LandmarkPostcard';

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
});
