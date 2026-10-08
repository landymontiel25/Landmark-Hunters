// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDragReorder } from './useDragReorder';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setup(initialIds, onReorder) {
  const api = {};
  function Probe({ ids }) {
    Object.assign(api, useDragReorder(ids, onReorder));
    return null;
  }
  const el = document.createElement('div');
  const root = createRoot(el);
  const render = (ids) => act(() => root.render(<Probe ids={ids} />));
  return { api, render, root };
}

const down = (pointerId = 1) => ({ button: 0, clientY: 0, pointerId, preventDefault() {}, currentTarget: {} });
const up = (pointerId = 1) => {
  const ev = new Event('pointerup');
  ev.pointerId = pointerId;
  return ev;
};

describe('useDragReorder', () => {
  it('keeps a stop added by someone else during the drag', async () => {
    const onReorder = vi.fn();
    const { api, render, root } = setup(['a', 'b'], onReorder);
    await render(['a', 'b']);
    await act(() => api.startDrag('a')(down()));
    await render(['a', 'b', 'x']);
    await act(() => window.dispatchEvent(up()));
    expect(onReorder).toHaveBeenCalledWith(['a', 'b', 'x']);
    await act(() => root.unmount());
  });
  it('does not bring back a stop removed during the drag', async () => {
    const onReorder = vi.fn();
    const { api, render, root } = setup(['a', 'b', 'c'], onReorder);
    await render(['a', 'b', 'c']);
    await act(() => api.startDrag('a')(down()));
    await render(['a', 'c']);
    await act(() => window.dispatchEvent(up()));
    expect(onReorder).toHaveBeenCalledWith(['a', 'c']);
    await act(() => root.unmount());
  });
  it('ignores another finger lifting, and unmount mid-drag saves nothing', async () => {
    const onReorder = vi.fn();
    const { api, render, root } = setup(['a', 'b'], onReorder);
    await render(['a', 'b']);
    await act(() => api.startDrag('a')(down(1)));
    await act(() => window.dispatchEvent(up(2)));
    expect(onReorder).not.toHaveBeenCalled();
    await act(() => root.unmount());
    window.dispatchEvent(up(1));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
