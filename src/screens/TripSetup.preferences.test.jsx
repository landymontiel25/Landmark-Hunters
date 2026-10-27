// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Owner, 2026-10-21: Create New Trip opens with no interest picked, and a
// the My Preferences button was removed the same week at the owner's ask.
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render({ saved = [] } = {}) {
  vi.doMock('../lib/TripContext', () => ({
    useTrip: () => {
      const [trip, setTrip] = useState({
        interests: ['food', 'sports'],
        customInterests: [],
        customInterestEmoji: {},
        savedInterests: saved,
        savedCustomInterests: [],
        activeRegion: 'miami',
        startingLocation: '',
      });
      const updateTrip = (patch) => setTrip((t) => ({ ...t, ...patch }));
      return {
        trip,
        updateTrip,
        setCustomInterestMatches: vi.fn(),
        setCustomInterestEmoji: vi.fn(),
        removeCustomInterest: vi.fn(),
      };
    },
  }));
  vi.doMock('../lib/useGpsStartLocation', () => ({ useGpsStartLocation: () => ({ useCurrentLocation: vi.fn(), locating: false, usingGps: false }) }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: null, friendsKnown: true, friendUids: new Set() }) }));
  vi.doMock('../components/LocationAutocomplete', () => ({ default: () => null, HomeStartPrefill: () => null }));
  vi.doMock('../components/RegionSearch', () => ({ default: () => null }));
  const { default: TripSetup } = await import('./TripSetup.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <TripSetup />
      </MemoryRouter>
    )
  );
  return { el: container };
}
const chip = (el, label) => [...el.querySelectorAll('.chip')].find((c) => c.textContent.includes(label));
const selected = (el) => [...el.querySelectorAll('.chip-grid .chip.selected')].map((c) => c.textContent.trim());

describe('Create New Trip: interests', () => {
  it('opens with nothing picked, even if last time had picks', async () => {
    const { el } = await render({ saved: ['food'] });
    expect(selected(el)).toEqual([]);
  });

  it('has no My Preferences button', async () => {
    const { el } = await render({ saved: ['food'] });
    expect(chip(el, 'My Preferences')).toBeUndefined();
    expect(el.textContent).not.toContain('No preferences saved yet');
  });
});
