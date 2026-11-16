// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A controllable IntersectionObserver: nothing is on screen until we say so.
const observers = [];
class IO {
  constructor(cb) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el) {
    this.el = el;
  }
  disconnect() {}
}

const fallbackOpts = [];
vi.mock('../lib/usePlacePhoto', () => ({
  usePlacePhoto: (landmark, opts) => {
    fallbackOpts.push(opts);
    return { photo: null };
  },
}));

beforeAll(() => {
  globalThis.IntersectionObserver = IO;
  vi.useFakeTimers();
});
afterAll(() => {
  delete globalThis.IntersectionObserver;
  vi.useRealTimers();
});

describe('LandmarkThumb photos further down a list (owner, 2026-11-15)', () => {
  it("never gives up on a lazy photo that hasn't come on screen yet, and times out only once it has", async () => {
    const { default: LandmarkThumb } = await import('./LandmarkThumb');
    const container = document.createElement('div');
    const root = createRoot(container);
    const landmark = { id: 'bayfront-park', name: 'Bayfront Park', categories: ['parks-nature'], images: ['a.jpg', 'b.jpg'] };
    await act(async () => root.render(<LandmarkThumb landmark={landmark} />));
    // Off screen for a long time: still its own photo, not the icon.
    await act(async () => vi.advanceTimersByTime(60000));
    expect(container.querySelector('img').getAttribute('src')).toBe('a.jpg');
    expect(container.querySelector('.landmark-thumb-fallback')).toBeNull();
    // It scrolls into view and stalls: then the next photo is tried.
    await act(async () => observers.at(-1).cb([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTime(12001));
    expect(container.querySelector('img').getAttribute('src')).toBe('b.jpg');
  });

  it("asks Google for a photo when every stored one failed, not only when there are none", async () => {
    const { default: LandmarkThumb } = await import('./LandmarkThumb');
    const container = document.createElement('div');
    const root = createRoot(container);
    fallbackOpts.length = 0;
    await act(async () => root.render(<LandmarkThumb landmark={{ id: 'zoo-miami', name: 'Zoo Miami', categories: ['attractions'], images: ['z.jpg'] }} />));
    expect(fallbackOpts.at(-1).enabled).toBe(false);
    await act(async () => container.querySelector('img').dispatchEvent(new Event('error')));
    expect(fallbackOpts.at(-1).enabled).toBe(true);
  });
});

describe('LandmarkThumb with no photo yet (owner, 2026-11-16)', () => {
  it('never shows a category icon: a plain shimmer while it looks, "No photo yet" if nothing is found', async () => {
    const { default: LandmarkThumb } = await import('./LandmarkThumb');
    const container = document.createElement('div');
    const root = createRoot(container);
    const park = { id: 'p', name: 'A Park', categories: ['parks-nature'], images: [] };
    await act(async () => root.render(<LandmarkThumb landmark={park} size={120} />));
    const tile = container.querySelector('.landmark-thumb-fallback');
    expect(tile.classList.contains('is-pending')).toBe(true);
    // No emoji or other glyph inside.
    expect(tile.textContent).toBe('');
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
