// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useVisibleInterval } from './useVisibleInterval';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

function mount(cb, active = true) {
  function Probe() {
    useVisibleInterval(cb, 1000, active);
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

describe('useVisibleInterval', () => {
  it('ticks while visible, stops while hidden, and catches up on return', () => {
    const cb = vi.fn();
    mount(cb);
    act(() => vi.advanceTimersByTime(3000));
    expect(cb).toHaveBeenCalledTimes(3);

    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(60000));
    expect(cb).toHaveBeenCalledTimes(3);

    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(cb).toHaveBeenCalledTimes(4); // immediate catch-up
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(6);
  });

  it('does nothing when inactive and cleans up on unmount', () => {
    const cb = vi.fn();
    mount(cb, false);
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).not.toHaveBeenCalled();
  });
});
