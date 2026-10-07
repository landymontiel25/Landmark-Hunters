// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { restoreScroll, saveListReturn, takeListReturn } from './listReturn';

beforeEach(() => sessionStorage.clear());

describe('listReturn', () => {
  it('hands back what was saved once, then nothing', () => {
    saveListReturn('landmarks', { y: 1200, city: 'miami', count: 150 });
    expect(takeListReturn('landmarks')).toEqual({ y: 1200, city: 'miami', count: 150 });
    expect(takeListReturn('landmarks')).toBeNull();
  });

  it('keeps lists apart and survives junk', () => {
    saveListReturn('a', { y: 1 });
    expect(takeListReturn('b')).toBeNull();
    sessionStorage.setItem('list-return:c', 'not json');
    expect(takeListReturn('c')).toBeNull();
  });
});

describe('restoreScroll', () => {
  let maxScroll;
  beforeEach(() => {
    vi.useFakeTimers();
    maxScroll = 100; // the page is short at first, like one still loading
    window.scrollY = 0;
    window.scrollTo = (_x, y) => {
      window.scrollY = Math.min(y, maxScroll);
    };
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps trying until the page is tall enough, then stops', () => {
    restoreScroll(900);
    vi.advanceTimersByTime(200);
    expect(window.scrollY).toBe(100);
    maxScroll = 5000;
    vi.advanceTimersByTime(200);
    expect(window.scrollY).toBe(900);
    window.scrollY = 0;
    vi.advanceTimersByTime(500);
    expect(window.scrollY).toBe(0); // done: no more nudging
  });

  it('gives up if the person scrolls', () => {
    restoreScroll(900);
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('wheel'));
    maxScroll = 5000;
    vi.advanceTimersByTime(500);
    expect(window.scrollY).toBe(100);
  });
});
