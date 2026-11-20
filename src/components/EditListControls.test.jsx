// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DragHandle, RemoveStopButton } from './EditListControls';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
afterEach(() => container?.remove());

describe('Edit List controls', () => {
  it('the remove button is a minus (an SVG, no emoji) that calls back, named for the stop', async () => {
    const onClick = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<RemoveStopButton name="Vizcaya" onClick={onClick} />));
    const b = container.querySelector('button');
    expect(b.getAttribute('aria-label')).toBe('Remove Vizcaya from this itinerary');
    expect(b.querySelector('svg')).toBeTruthy();
    await act(async () => b.click());
    expect(onClick).toHaveBeenCalled();
  });

  it('the drag handle keeps its pointer and keyboard reorder', async () => {
    const down = vi.fn();
    const key = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<DragHandle name="Vizcaya" onPointerDown={down} onKeyDown={key} className="drag-handle-end" />));
    const b = container.querySelector('button.drag-handle.drag-handle-end');
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(key).toHaveBeenCalled();
    expect(b.getAttribute('aria-label')).toMatch(/Reorder Vizcaya/);
  });
});
