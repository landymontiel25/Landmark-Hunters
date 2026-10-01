// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PICKABLE_REGIONS } from '../data/regions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

vi.mock('../lib/smartSearch', () => ({ useSmartCitySearch: () => ({ cities: [], loading: false }) }));

async function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(el) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(el));
  return container;
}

describe('city search boxes', () => {
  it('RegionSearch says so when nothing matches instead of silently closing', async () => {
    const { default: RegionSearch } = await import('./RegionSearch.jsx');
    const el = await mount(<RegionSearch region={null} onSelect={() => {}} />);
    const input = el.querySelector('input');
    await act(async () => input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await type(input, 'zzzzqqqq');
    expect(el.textContent).toContain('No cities match');
  });

  it('MultiRegionSearch Enter does not remove a city that is already picked', async () => {
    const { default: Multi } = await import('./MultiRegionSearch.jsx');
    const onToggle = vi.fn();
    const first = [...PICKABLE_REGIONS].sort((a, b) => a.name.localeCompare(b.name))[0];
    const el = await mount(<Multi selectedIds={[first.id]} onToggle={onToggle} onClearAll={() => {}} />);
    const input = el.querySelector('input');
    await type(input, first.name);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // Whatever the top match is, Enter must never toggle an already-selected city.
    for (const [r] of onToggle.mock.calls) expect(r.id).not.toBe(first.id);
  });
});
