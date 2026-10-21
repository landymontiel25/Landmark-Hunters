// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19 } }) }));
vi.mock('../components/LandmarkThumb', () => ({ default: () => null }));

import RatingSliderLab, { pointAt, tierForValue } from './RatingSliderLab';

let container;
afterEach(() => container?.remove());
const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<RatingSliderLab />));
};
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));

describe('Rating slider (Test tab)', () => {
  it('snaps a drag to the nearest of 5 points', () => {
    expect(pointAt(0)).toBe(1);
    expect(pointAt(0.3)).toBe(2);
    expect(pointAt(0.5)).toBe(3);
    expect(pointAt(0.9)).toBe(5);
    expect(pointAt(1.4)).toBe(5);
  });
  it('maps 1-5 onto the three answers saved today', () => {
    expect([1, 2, 3, 4, 5].map(tierForValue)).toEqual(["I didn't like it", "I didn't like it", 'Ok', 'I loved it', 'I loved it']);
  });
  it('keeps the three phrases on the line, and checks in only after a pick', async () => {
    await render();
    const labels = container.querySelector('.rate-slider-labels').textContent;
    expect(labels).toContain('Not for me');
    expect(labels).toContain("It's ok");
    expect(labels).toContain('I love it');
    expect(button('Check in').disabled).toBe(true);
    const slider = container.querySelector('[role="slider"]');
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(slider.getAttribute('aria-valuenow')).toBe('3');
    await act(async () => button('Check in').click());
    expect(container.textContent).toContain('3/5 (It\'s ok)');
  });
  // Owner, 2026-10-21: a finger dragging the line covered the phrases under
  // it, and the emoji looked childish.
  it('puts the phrases above the line and uses a line icon, not an emoji, on the thumb', async () => {
    await render();
    const labels = container.querySelector('.rate-slider-labels');
    const track = container.querySelector('.rate-slider-track');
    expect(labels.compareDocumentPosition(track) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const slider = container.querySelector('[role="slider"]');
    for (let i = 0; i < 5; i++) await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    const thumb = container.querySelector('.rate-slider-thumb');
    expect(thumb.querySelector('svg.rate-icon')).toBeTruthy();
    expect(thumb.textContent).toBe('');
    expect(container.querySelector('.rate-slider-label.on').textContent).toBe('I love it5');
  });
});
