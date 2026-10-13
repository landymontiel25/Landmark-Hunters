// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/groupTrips', () => ({ listMyGroupTrips: async () => [], toggleGroupLandmark: async () => {} }));

import { TripProvider, useTrip } from '../lib/TripContext';
import SaveLandmarkButton from './SaveLandmarkButton';

let container;
let root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  localStorage.clear();
});

let tripRef;
function Probe() {
  tripRef = useTrip().trip;
  return null;
}

describe('SaveLandmarkButton', () => {
  it('saves to Save for later, offers the city itinerary, and unsaves on a second tap', async () => {
    const landmark = { id: 'vizcaya', name: 'Vizcaya' };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <TripProvider>
          <SaveLandmarkButton landmark={landmark} regionId="miami" />
          <Probe />
        </TripProvider>
      )
    );
    const bookmark = () => container.querySelector('button[aria-pressed]');
    expect(bookmark().getAttribute('aria-pressed')).toBe('false');

    await act(async () => bookmark().click());
    expect(tripRef.savedForLater).toEqual([{ regionId: 'miami', id: 'vizcaya', name: 'Vizcaya' }]);
    expect(bookmark().getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toContain('Saved to Save for later');

    const startRow = [...document.querySelectorAll('.save-sheet-row')].find((b) => b.textContent.includes('Start a Miami itinerary'));
    await act(async () => startRow.click());
    expect(tripRef.byRegion.miami).toEqual(['vizcaya']);

    const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done');
    await act(async () => done.click());
    expect(document.body.textContent).not.toContain('Saved to Save for later');

    await act(async () => bookmark().click());
    expect(tripRef.savedForLater).toEqual([]);
    expect(tripRef.byRegion.miami).toEqual(['vizcaya']);
  });
});
