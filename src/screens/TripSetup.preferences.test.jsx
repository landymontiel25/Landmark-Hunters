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
  localStorage.clear();
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

const tabBtn = (el, label) => [...el.querySelectorAll('.tab-btn')].find((b) => b.textContent.includes(label));

describe('Create New Trip: Play, Plan and interests', () => {
  it('opens on Play, with the interest chips and trip type tucked behind Plan', async () => {
    const { el } = await render({ saved: ['food'] });
    expect(tabBtn(el, 'Play').getAttribute('aria-pressed')).toBe('true');
    expect(tabBtn(el, 'Plan').getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('.chip-grid')).toBeNull();
    expect(chip(el, 'My Preferences')).toBeUndefined();
  });

  it('Plan opens with nothing picked, even if last time had picks, and Top Landmarks leads the chips', async () => {
    const { el } = await render({ saved: ['food'] });
    await act(async () => tabBtn(el, 'Plan').click());
    expect(selected(el)).toEqual([]);
    expect(el.querySelector('.chip-grid .chip').textContent).toContain('Top Landmarks');
    expect(el.textContent).toContain('Choose Landmarks');
  });

  it('Play opens the Landmarks tab on Top Landmarks', async () => {
    const { el } = await render();
    localStorage.setItem('lh.draft.v1.landmarks.sort.v3', JSON.stringify({ v: 'forMe', t: Date.now() }));
    await act(async () => tabBtn(el, 'Play').click());
    expect(JSON.parse(localStorage.getItem('lh.draft.v1.landmarks.sort.v3')).v).toBe('rated');
  });

  it('the Top Landmarks chip sets that sort when you tap Choose Landmarks', async () => {
    const { el } = await render();
    localStorage.setItem('lh.draft.v1.landmarks.sort.v3', JSON.stringify({ v: 'nearMe', t: Date.now() }));
    await act(async () => tabBtn(el, 'Plan').click());
    await act(async () => chip(el, 'Top Landmarks').click());
    expect(chip(el, 'Top Landmarks').getAttribute('aria-pressed')).toBe('true');
    await act(async () => tabBtn(el, 'Solo').click());
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Choose Landmarks')).click());
    expect(JSON.parse(localStorage.getItem('lh.draft.v1.landmarks.sort.v3')).v).toBe('rated');
  });
});
