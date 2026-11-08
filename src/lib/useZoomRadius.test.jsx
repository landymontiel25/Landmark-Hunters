// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useZoomRadius, _resetZoomRadius } from './useZoomRadius';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api;
function Probe() {
  api = useZoomRadius();
  return null;
}
const mount = async () => {
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  return root;
};
afterEach(() => _resetZoomRadius());

describe('useZoomRadius (owner, 2026-11-08: the Map opens at 5 mi)', () => {
  it('starts at 5 mi, even if an old saved value says otherwise', async () => {
    localStorage.setItem('lh-zoom-radius-miles', '50');
    const root = await mount();
    expect(api[0]).toBe(5);
    act(() => root.unmount());
  });
  it('keeps a choice while the app is open, and a launch goes back to 5', async () => {
    let root = await mount();
    await act(async () => api[1](25));
    act(() => root.unmount());
    root = await mount();
    expect(api[0]).toBe(25);
    act(() => root.unmount());
    _resetZoomRadius();
    root = await mount();
    expect(api[0]).toBe(5);
    act(() => root.unmount());
  });
});
