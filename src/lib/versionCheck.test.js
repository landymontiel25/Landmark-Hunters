// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { currentBundle, latestBundle, watchForNewVersion } from './versionCheck';

const setVisibility = (v) => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('versionCheck', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    vi.useRealTimers();
  });

  it('reads the hashed bundle from the page and from fresh HTML', () => {
    document.head.innerHTML = '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>';
    expect(currentBundle()).toBe('/assets/index-AbC123.js');
    expect(latestBundle('<script type="module" src="/assets/index-Zz9.js"></script>')).toBe('/assets/index-Zz9.js');
  });

  it('reloads only after a long break and only when the build changed', async () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>';
    const reload = vi.fn();
    const fetchHtml = vi.fn(async () => '<script type="module" src="/assets/index-new.js"></script>');
    const stop = watchForNewVersion({ fetchHtml, reload });

    setVisibility('hidden');
    vi.advanceTimersByTime(60 * 1000);
    setVisibility('visible');
    await Promise.resolve();
    expect(fetchHtml).not.toHaveBeenCalled();

    setVisibility('hidden');
    vi.advanceTimersByTime(31 * 60 * 1000);
    setVisibility('visible');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    stop();
  });

  it('stays put when the build is the same', async () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<script type="module" src="/assets/index-same.js"></script>';
    const reload = vi.fn();
    const fetchHtml = vi.fn(async () => '<script type="module" src="/assets/index-same.js"></script>');
    const stop = watchForNewVersion({ fetchHtml, reload });
    setVisibility('hidden');
    vi.advanceTimersByTime(31 * 60 * 1000);
    setVisibility('visible');
    await vi.waitFor(() => expect(fetchHtml).toHaveBeenCalled());
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
