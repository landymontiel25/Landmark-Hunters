// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useZoomRadius, zoomOptionAtLeast, ZOOM_RADIUS_OPTIONS } from './useZoomRadius';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;
function Probe({ scope }) {
  latest = useZoomRadius(scope);
  return null;
}
const mount = async (scope) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe scope={scope} />));
};
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  localStorage.clear();
});

describe('useZoomRadius', () => {
  it('starts at 5 and remembers a choice', async () => {
    await mount(null);
    expect(latest[0]).toBe(5);
    await act(async () => latest[1](10));
    expect(localStorage.getItem('lh-zoom-radius-miles')).toBe('10');
  });

  it("gives the Test tab its own setting: it starts at 5 even when the real Map was left on 1, and doesn't change it", async () => {
    localStorage.setItem('lh-zoom-radius-miles', '1');
    await mount('test');
    expect(latest[0]).toBe(5);
    await act(async () => latest[1](25));
    expect(localStorage.getItem('lh-zoom-radius-miles:test')).toBe('25');
    expect(localStorage.getItem('lh-zoom-radius-miles')).toBe('1');
  });

  it('keeps using the real setting when no scope is given', async () => {
    localStorage.setItem('lh-zoom-radius-miles', '1');
    await mount(null);
    expect(latest[0]).toBe(1);
  });
});

describe('zoomOptionAtLeast', () => {
  it('lands on a real radius option, rounding up', () => {
    expect(zoomOptionAtLeast(1)).toBe(1);
    expect(zoomOptionAtLeast(3)).toBe(5);
    expect(zoomOptionAtLeast(15)).toBe(25);
    expect(zoomOptionAtLeast(30)).toBe(50);
    expect(zoomOptionAtLeast(1000)).toBe(100);
    for (const n of [1, 4, 12, 20, 60]) expect(ZOOM_RADIUS_OPTIONS).toContain(zoomOptionAtLeast(n));
  });
});
