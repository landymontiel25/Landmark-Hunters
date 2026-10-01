// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTodayKey } from './useTodayKey';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
let seen;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

function mount() {
  function Probe() {
    seen = useTodayKey();
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

describe('useTodayKey', () => {
  it('moves to the new day when the page becomes visible after a sleep past midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 23, 0, 0));
    mount();
    expect(seen).toBe('2026-5-10');
    // Device slept: the clock moved on without the timer firing.
    vi.setSystemTime(new Date(2026, 5, 11, 7, 0, 0));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(seen).toBe('2026-5-11');
  });
  it('rolls over at midnight and keeps rolling on following days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 23, 59, 0));
    mount();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(seen).toBe('2026-5-11');
    act(() => {
      vi.advanceTimersByTime(24 * 3600_000);
    });
    expect(seen).toBe('2026-5-12');
  });
});
