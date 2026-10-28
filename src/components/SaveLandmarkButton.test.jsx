// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  user: null,
  rows: [],
  listeners: [],
  addFavorite: vi.fn(async () => {}),
  setFavoriteNote: vi.fn(async () => {}),
  removeFavorite: vi.fn(async () => {}),
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('../lib/favorites', () => ({
  FAVORITE_NOTE_MAX: 500,
  favoriteId: (r, i) => `${r}__${i}`,
  addFavorite: h.addFavorite,
  setFavoriteNote: h.setFavoriteNote,
  removeFavorite: h.removeFavorite,
  subscribeFavorites: (_uid, cb) => {
    cb(h.rows);
    return () => {};
  },
}));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/groupTrips', () => ({
  listMyGroupTrips: async () => [],
  toggleGroupLandmark: async () => {},
  addGroupPlace: async () => {},
  removeGroupPlace: async () => {},
}));

import { TripProvider, useTrip } from '../lib/TripContext';
import SaveLandmarkButton, { ItinerarySheet } from './SaveLandmarkButton';
import { FavoritesProvider } from '../lib/FavoritesContext';
import { MemoryRouter } from 'react-router-dom';

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
  const mount = async (children) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TripProvider>
            <FavoritesProvider>{children}</FavoritesProvider>
            <Probe />
          </TripProvider>
        </MemoryRouter>
      )
    );
  };
  const bookmark = () => container.querySelector('button[aria-haspopup="dialog"]');
  const row = (text) => [...document.querySelectorAll('.save-sheet-row')].find((b) => b.textContent.includes(text));
  const landmark = { id: 'vizcaya', name: 'Vizcaya', lat: 25.7, lng: -80.2 };

  const tab = (label) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(label));

  it('the bookmark opens a sheet with two tabs: Itinerary and Favorites', async () => {
    h.user = null;
    await mount(<SaveLandmarkButton landmark={landmark} regionId="miami" />);
    await act(async () => bookmark().click());
    expect(tab('Itinerary').getAttribute('aria-selected')).toBe('true');
    expect(tab('Favorites').getAttribute('aria-selected')).toBe('false');
    expect(document.body.textContent).toContain('Add it to an itinerary');
    // Favorites shows its own content and hides the itinerary rows.
    await act(async () => tab('Favorites').click());
    expect(document.body.textContent).toContain('Sign in');
    expect(document.body.textContent).not.toContain('Add it to an itinerary');
    await act(async () => tab('Itinerary').click());
    await act(async () => row('Start a Miami itinerary').click());
    expect(tripRef.byRegion.miami).toEqual(['vizcaya']);
    expect(tripRef.savedForLater).toEqual([]);
    const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done');
    await act(async () => done.click());
    expect(document.body.textContent).not.toContain('Add it to an itinerary');
  });

  it('signed in: Add to Favorites saves the place', async () => {
    h.user = { uid: 'me' };
    h.rows = [];
    h.addFavorite.mockClear();
    h.setFavoriteNote.mockClear();
    await mount(<SaveLandmarkButton landmark={landmark} regionId="miami" />);
    await act(async () => bookmark().click());
    await act(async () => tab('Favorites').click());
    await act(async () => row('Add to Favorites').click());
    expect(h.addFavorite).toHaveBeenCalledWith('me', { region: 'miami', id: 'vizcaya', name: 'Vizcaya', lat: 25.7, lng: -80.2, note: '' });
  });

  it('a favorite place fills the bookmark and shows its note, which can be edited', async () => {
    h.user = { uid: 'me' };
    h.rows = [{ region: 'miami', id: 'vizcaya', name: 'Vizcaya', lat: 25.7, lng: -80.2, note: 'Go at sunset', savedAt: 1 }];
    h.setFavoriteNote.mockClear();
    await mount(<SaveLandmarkButton landmark={landmark} regionId="miami" />);
    expect(bookmark().className).toContain('is-saved');
    await act(async () => bookmark().click());
    await act(async () => tab('Favorites').click());
    const box = document.querySelector('textarea');
    expect(box.value).toBe('Go at sunset');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, 'Go at sunset, bring cash');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save note').click());
    expect(h.setFavoriteNote).toHaveBeenCalledWith('me', 'miami', 'vizcaya', 'Go at sunset, bring cash');
  });

  // Owner ask 2026-10-24: a place can go on any itinerary you have, with its
  // own city's first.
  it("lists this city's itinerary first, then every other one, and adds across cities as a linked place", async () => {
    localStorage.setItem(
      'landmarkhunters.trip.v1',
      JSON.stringify({ byRegion: { 'san-francisco': ['ferry-building'], miami: ['vizcaya'] }, itineraryNames: { 'san-francisco': 'SF Weekend' } })
    );
    const landmark = { id: 'south-pointe-park', name: 'South Pointe Park and Pier', lat: 25.765, lng: -80.134 };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <TripProvider>
          <ItinerarySheet landmark={landmark} regionId="miami" onClose={() => {}} />
          <Probe />
        </TripProvider>
      )
    );
    const rows = [...document.querySelectorAll('.save-sheet-row')];
    expect(rows.map((b) => b.textContent)).toEqual([expect.stringContaining('Miami'), expect.stringContaining('SF Weekend')]);

    await act(async () => rows[0].click());
    await act(async () => rows[1].click());
    expect(tripRef.byRegion.miami).toEqual(['vizcaya', 'south-pointe-park']);
    expect(tripRef.byRegion['san-francisco']).toEqual(['ferry-building']);
    expect(tripRef.placesByRegion['san-francisco']).toEqual([
      expect.objectContaining({ id: 'lm:miami:south-pointe-park', fromRegion: 'miami', landmarkId: 'south-pointe-park', lat: 25.765 }),
    ]);

    await act(async () => rows[1].click());
    expect(tripRef.placesByRegion['san-francisco']).toBeUndefined();
  });
});
