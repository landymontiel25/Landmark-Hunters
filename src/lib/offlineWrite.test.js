// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settleWrite, WRITE_QUEUED_EVENT, WRITE_REJECTED_EVENT } from './offlineWrite';

let onLine;
beforeEach(() => {
  vi.useFakeTimers();
  onLine = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => onLine });
});
afterEach(() => vi.useRealTimers());

function listen(name) {
  const fn = vi.fn();
  window.addEventListener(name, fn);
  return fn;
}

describe('settleWrite', () => {
  it('passes through a write that settles', async () => {
    await expect(settleWrite(Promise.resolve(7))).resolves.toBe(7);
    await expect(settleWrite(Promise.reject(new Error('nope')))).rejects.toThrow('nope');
  });

  it('resolves as queued, and says so, when an offline write never settles', async () => {
    onLine = false;
    const queued = listen(WRITE_QUEUED_EVENT);
    const p = settleWrite(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(4100);
    await expect(p).resolves.toEqual({ queued: true });
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while online, then catches a drop mid-wait', async () => {
    const p = settleWrite(new Promise(() => {}));
    let settled = false;
    p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9000);
    expect(settled).toBe(false);
    onLine = false;
    await vi.advanceTimersByTimeAsync(4100);
    expect(settled).toBe(true);
  });

  it('announces a queued write that is rejected after reconnecting', async () => {
    onLine = false;
    const rejected = listen(WRITE_REJECTED_EVENT);
    let rej;
    const p = settleWrite(new Promise((_, r) => (rej = r)));
    await vi.advanceTimersByTimeAsync(4100);
    await p;
    rej(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});
