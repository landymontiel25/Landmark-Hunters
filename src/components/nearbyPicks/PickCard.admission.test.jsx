// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '0.3 mi' }));

import PickCard, { PickRow } from './PickCard';
import { toPick } from '../../lib/nearbyPicks';

let container;
afterEach(() => container?.remove());
async function render(ui) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<MemoryRouter>{ui}</MemoryRouter>));
  return container;
}
const pick = (over) => toPick({ id: 'x', regionId: 'miami', name: 'Place X', lat: 25, lng: -80, categories: ['history-culture'], distanceMeters: 480, ...over });

// Owner, 2026-10-29: mark which places are free and which need tickets.
describe('picks say whether a place is free or needs a ticket', () => {
  it('a free place says Free, a ticketed one says Needs a ticket, an unknown one says nothing', async () => {
    const free = await render(<ul><PickRow pick={pick({ free: true })} /></ul>);
    expect(free.querySelector('.mpp-row-body').textContent).toContain('Free');
    free.remove();
    const paid = await render(<PickCard pick={pick({ free: false })} />);
    expect(paid.querySelector('.mpp-card-meta').textContent).toContain('Needs a ticket');
    paid.remove();
    const unknown = await render(<PickCard pick={pick({})} />);
    expect(unknown.querySelector('.mpp-card-meta').textContent).not.toMatch(/Free|ticket/);
  });
});
