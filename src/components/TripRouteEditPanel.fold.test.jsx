// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import TripRouteEditPanel from './TripRouteEditPanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stops = [
  { id: 'a', name: 'Resort' },
  { id: 'b', name: 'Reef' },
  { id: 'c', name: 'Beach' },
];

describe('TripRouteEditPanel folds (owner, 2026-11-23)', () => {
  it('folds to a bar with the name and count, keeps the edits and edit mode, and opens again', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<TripRouteEditPanel name="Abacos Trip" stops={stops} ids={['c', 'a']} onReorder={() => {}} onSelectAll={() => {}} onSave={onSave} onCancel={onCancel} />));
    const panel = () => el.querySelector('.trip-route-edit');
    const grabber = el.querySelector('.trip-route-grabber');
    expect(grabber.getAttribute('aria-expanded')).toBe('true');

    await act(async () => grabber.click());
    expect(panel().classList.contains('trip-route-edit-folded')).toBe(true);
    expect(el.querySelector('h3').textContent).toContain('Edit route: Abacos Trip');
    expect(el.querySelector('h3').textContent).toContain('2 of 3 stops');
    expect(el.querySelector('.trip-route-edit-body').getAttribute('aria-hidden')).toBe('true');
    // Folding is not leaving: nothing cancelled, nothing saved.
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => el.querySelector('.trip-route-chevron').click());
    expect(panel().classList.contains('trip-route-edit-folded')).toBe(false);
    // The same route, in the same order, with Save back.
    expect([...el.querySelectorAll('.trip-route-edit-list li')].map((li) => li.textContent.replace('☰', ''))).toEqual(['1. Beach', '2. Resort']);
    expect(el.querySelector('.trip-route-save')).toBeTruthy();
    await act(async () => root.unmount());
  });
});
