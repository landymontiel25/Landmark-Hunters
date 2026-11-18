// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Lightbox from './Lightbox';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
let root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

const pointer = (type, el, x = 100, y = 100, id = 1) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  el.dispatchEvent(e);
};
async function open(onClose = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Lightbox src="https://example.com/a.jpg" alt="A place" onClose={onClose} />));
  return { onClose, stage: document.querySelector('.lightbox-stage'), img: () => document.querySelector('.lightbox-stage img') };
}

describe('Lightbox', () => {
  it('opens full-screen with a Close button', async () => {
    const { onClose } = await open();
    const close = document.querySelector('.lightbox-close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalled();
  });

  it('double-tap zooms in and back out', async () => {
    const { img } = await open();
    const tap = async () => {
      await act(async () => pointer('pointerdown', img()));
      await act(async () => pointer('pointerup', img()));
    };
    await tap();
    await tap();
    expect(img().style.transform).toContain('scale(2.5)');
    await tap();
    await tap();
    expect(img().style.transform).toContain('scale(1)');
  });

  it('pinches to zoom, never past the limit once settled', async () => {
    const { img } = await open();
    await act(async () => pointer('pointerdown', img(), 100, 100, 1));
    await act(async () => pointer('pointerdown', img(), 200, 100, 2));
    await act(async () => pointer('pointermove', img(), 400, 100, 2));
    expect(Number(/scale\(([\d.]+)\)/.exec(img().style.transform)[1])).toBeGreaterThan(2);
    await act(async () => pointer('pointerup', img(), 400, 100, 2));
    await act(async () => pointer('pointerup', img(), 100, 100, 1));
    expect(Number(/scale\(([\d.]+)\)/.exec(img().style.transform)[1])).toBeLessThanOrEqual(5);
  });

  it('a tap beside the photo closes it', async () => {
    const { onClose, stage } = await open();
    await act(async () => stage.click());
    expect(onClose).toHaveBeenCalled();
  });
});
