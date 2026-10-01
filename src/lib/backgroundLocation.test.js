import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ pending: [] }));
const { addWatcher, removeWatcher } = vi.hoisted(() => ({
  addWatcher: vi.fn(() => new Promise((res) => h.pending.push(res))),
  removeWatcher: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ addWatcher, removeWatcher }) }));
let pending;

import { startBackgroundLocation, stopBackgroundLocation } from './backgroundLocation';

beforeEach(async () => {
  h.pending.length = 0;
  pending = h.pending;
  addWatcher.mockClear();
  removeWatcher.mockClear();
});

describe('background location watcher', () => {
  it('stop while start is still pending does not leak the watcher', async () => {
    const started = startBackgroundLocation(() => {});
    await new Promise((r) => setTimeout(r, 0));
    await stopBackgroundLocation();
    pending[0]('w1');
    await started;
    expect(removeWatcher).toHaveBeenCalledWith({ id: 'w1' });
  });
  it('two overlapping starts leave only one watcher running', async () => {
    const a = startBackgroundLocation(() => {});
    const b = startBackgroundLocation(() => {});
    await new Promise((r) => setTimeout(r, 0));
    pending.forEach((res, i) => res('w' + i));
    await Promise.all([a, b]);
    expect(addWatcher.mock.calls.length - removeWatcher.mock.calls.length).toBe(1);
  });
});
