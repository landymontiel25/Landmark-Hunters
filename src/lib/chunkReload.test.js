// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_WINDOW_MS, flagClear, flagGet, flagSet, shouldReloadForChunkError } from './chunkReload';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.name = '';
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('chunk reload guard', () => {
  it('reloads once, then stops, with working sessionStorage', () => {
    expect(shouldReloadForChunkError()).toBe(true);
    flagSet();
    expect(shouldReloadForChunkError()).toBe(false);
    flagClear();
    expect(shouldReloadForChunkError()).toBe(true);
  });

  it('still stops after one reload when sessionStorage throws (no reload loop)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(shouldReloadForChunkError()).toBe(true);
    flagSet();
    expect(flagGet()).toBe('1');
    expect(shouldReloadForChunkError()).toBe(false);
    flagClear();
    expect(shouldReloadForChunkError()).toBe(true);
  });

  it('does not reload while offline', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    expect(shouldReloadForChunkError()).toBe(false);
  });

  it('allows another reload once the last one is older than the window (a later deploy)', () => {
    flagSet(1000);
    expect(shouldReloadForChunkError(1000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(shouldReloadForChunkError(1000 + RELOAD_WINDOW_MS + 1)).toBe(true);
  });
});
