// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import TripRouteEditPanel from './TripRouteEditPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let el;
afterEach(() => el?.remove());
const stops = [
  { id: 'a', name: 'Marina' },
  { id: 'b', name: 'Beach' },
  { id: 'c', name: 'Pool' },
];
async function mount(props) {
  el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<TripRouteEditPanel name="Abacos" stops={stops} onReorder={() => {}} onSelectAll={() => {}} onSave={() => {}} onCancel={() => {}} {...props} />));
}
const button = (t) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === t);

describe('TripRouteEditPanel', () => {
  it('lists the stops on the route in order, each with a drag handle', async () => {
    await mount({ ids: ['c', 'a'] });
    const rows = [...el.querySelectorAll('.trip-route-edit-list li')].map((li) => li.textContent);
    expect(rows[0]).toContain('1. Pool');
    expect(rows[1]).toContain('2. Marina');
    expect(el.querySelectorAll('.drag-handle')).toHaveLength(2);
    expect(el.textContent).toContain('2 of 3 stops');
  });
  it('Select all puts the missing stops back; it is off when all are in', async () => {
    const onSelectAll = vi.fn();
    await mount({ ids: ['a'], onSelectAll });
    await act(async () => button('Select all').click());
    expect(onSelectAll).toHaveBeenCalled();
    el.remove();
    await mount({ ids: ['a', 'b', 'c'] });
    expect(button('Select all').disabled).toBe(true);
  });
  it('Save ends edit mode, and needs at least one stop', async () => {
    const onSave = vi.fn();
    await mount({ ids: ['a'], onSave });
    await act(async () => button('Save').click());
    expect(onSave).toHaveBeenCalled();
    el.remove();
    await mount({ ids: [] });
    expect(button('Save').disabled).toBe(true);
  });
});

describe('TripRouteEditPanel Cancel', () => {
  it('leaves without saving', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    await mount({ ids: ['a'], onCancel, onSave });
    await act(async () => button('Cancel').click());
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
