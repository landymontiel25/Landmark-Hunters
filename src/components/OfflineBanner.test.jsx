// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import OfflineBanner from './OfflineBanner';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Found by the app simulation: offline on the Map tab the banner sat under
// the full-screen map (never seen) and pushed the header onto the map's
// floating onboarding banner. It is sticky above the map now and tells the
// layout its height through --offline-h.
let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<OfflineBanner />));
}

describe('OfflineBanner', () => {
  it('offline: sticky above the map, and its height is set as --offline-h', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
    mount();
    const banner = host.querySelector('[role=status]');
    expect(banner.textContent).toMatch(/offline/i);
    expect(banner.style.position).toBe('sticky');
    expect(Number(banner.style.zIndex)).toBeGreaterThan(1000);
    expect(document.documentElement.style.getPropertyValue('--offline-h')).toBe('48px');
  });

  it('back online: the banner and --offline-h go away', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    mount();
    expect(host.querySelector('[role=status]')).not.toBeNull();
    act(() => window.dispatchEvent(new Event('online')));
    expect(host.querySelector('[role=status]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--offline-h')).toBe('');
  });

  it('online: nothing shows and nothing is set', () => {
    mount();
    expect(host.textContent).toBe('');
    expect(document.documentElement.style.getPropertyValue('--offline-h')).toBe('');
  });
});
