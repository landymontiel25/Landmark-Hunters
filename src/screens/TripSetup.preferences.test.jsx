// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Owner, 2026-10-21: Create New Trip opens with no interest picked, and a
// "My Preferences" button fills in the saved ones.
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render({ saved = [] } = {}) {
  const calls = { applyPreferences: vi.fn() };
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
        applyPreferences: () => {
          calls.applyPreferences();
          setTrip((t) => ({ ...t, interests: [...t.savedInterests] }));
        },
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
  return { el: container, calls };
}
const chip = (el, label) => [...el.querySelectorAll('.chip')].find((c) => c.textContent.includes(label));
const selected = (el) => [...el.querySelectorAll('.chip-grid .chip.selected')].map((c) => c.textContent.trim());

describe('Create New Trip: interests and My Preferences', () => {
  it('opens with nothing picked, even if last time had picks', async () => {
    const { el } = await render({ saved: ['food'] });
    expect(selected(el)).toEqual([]);
  });

  it('My Preferences fills in the saved ones, and tapping it again clears them', async () => {
    const { el, calls } = await render({ saved: ['food', 'local-life'] });
    const button = chip(el, 'My Preferences');
    await act(async () => button.click());
    expect(calls.applyPreferences).toHaveBeenCalledTimes(1);
    expect(selected(el)).toHaveLength(2);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await act(async () => button.click());
    expect(selected(el)).toEqual([]);
  });

  it('shows the button with none saved, and says where to set them', async () => {
    const { el, calls } = await render({ saved: [] });
    const button = chip(el, 'My Preferences');
    expect(button).toBeTruthy();
    await act(async () => button.click());
    expect(calls.applyPreferences).not.toHaveBeenCalled();
    expect(el.textContent).toContain('No preferences saved yet. Set them in Settings, under My Preferences.');
  });
});
