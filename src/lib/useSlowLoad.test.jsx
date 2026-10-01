// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSlowLoad } from './useSlowLoad';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

function mount(waiting) {
  const seen = { value: null };
  function Probe({ waiting: w }) {
    seen.value = useSlowLoad(w, 1000);
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Probe waiting={waiting} />));
  return { seen, rerender: (w) => act(() => root.render(<Probe waiting={w} />)) };
}

describe('useSlowLoad', () => {
  it('flips true only after the wait outlasts the limit, and resets when loading ends', () => {
    vi.useFakeTimers();
    const { seen, rerender } = mount(true);
    expect(seen.value).toBe(false);
    act(() => vi.advanceTimersByTime(1100));
    expect(seen.value).toBe(true);
    rerender(false);
    expect(seen.value).toBe(false);
  });

  it('never fires when nothing is being waited on', () => {
    vi.useFakeTimers();
    const { seen } = mount(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(seen.value).toBe(false);
  });
});
