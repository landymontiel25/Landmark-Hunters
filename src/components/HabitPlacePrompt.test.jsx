// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

let coords = { lat: 1, lng: 1 };
let due = null;
const reverseGeocodePlace = vi.fn();
const findRelatedStop = vi.fn();

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords }) }));
vi.mock('../lib/TripContext', () => ({
  useTrip: () => ({ trip: { savedInterests: ['food'] }, addPlace: vi.fn(), addLandmark: vi.fn() }),
}));
const profile = { tasteIntro: 'tacos' };
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: profile }) }));
vi.mock('../lib/placeLookup', () => ({
  reverseGeocodePlace: (...a) => reverseGeocodePlace(...a),
  nearestRegionId: () => 'philly',
  placeId: () => 'p',
  lookupPlace: vi.fn(),
}));
vi.mock('../lib/geo', () => ({ distanceMeters: () => 1e9 }));
vi.mock('../data/regions', () => ({ ALL_LANDMARKS: [] }));
vi.mock('../lib/notifications', () => ({ notifyUser: async () => {} }));
vi.mock('../lib/habitNearby', () => ({ findRelatedStop: (...a) => findRelatedStop(...a) }));
vi.mock('../lib/habitTracking', () => ({
  recordVisit: () => {},
  getDueSuggestion: () => due,
  typicalTimeLabel: () => '',
  recordPrompted: () => {},
  resolveClusterName: () => {},
  markLookupFailed: () => {},
  markClusterAdded: () => {},
  dismissCluster: () => {},
}));

import HabitPlacePrompt from './HabitPlacePrompt';

let container;
let root;
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  reverseGeocodePlace.mockReset();
  findRelatedStop.mockReset();
  due = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<HabitPlacePrompt />));
}
const rerender = () => act(async () => root.render(<HabitPlacePrompt />));
const click = (text) =>
  act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text)).click());

describe('HabitPlacePrompt', () => {
  it('looks a place name up once while GPS fixes keep arriving', async () => {
    due = { id: 'c1', lat: 1, lng: 1, days: [1, 2, 3] };
    let finish;
    reverseGeocodePlace.mockImplementation(() => new Promise((r) => (finish = r)));
    await mount();
    coords = { lat: 1.00001, lng: 1 };
    await rerender();
    coords = { lat: 1.00002, lng: 1 };
    await rerender();
    expect(reverseGeocodePlace).toHaveBeenCalledTimes(1);

    // Once it settles (here: failed), a later fix may try again.
    await act(async () => finish(null));
    coords = { lat: 1.00003, lng: 1 };
    await rerender();
    expect(reverseGeocodePlace).toHaveBeenCalledTimes(2);
  });

  it("doesn't show a late nearby-stop answer inside the next place's prompt", async () => {
    let answerA;
    findRelatedStop.mockImplementationOnce(() => new Promise((r) => (answerA = r)));
    findRelatedStop.mockImplementation(() => new Promise(() => {}));
    due = { id: 'A', name: 'Dunkin', lat: 1, lng: 1, days: [1, 2, 3] };
    await mount();
    expect(container.textContent).toContain('Dunkin');
    due = null;
    await click('Not now');
    await act(async () => answerA({ name: 'Shooting Range' }));

    due = { id: 'B', name: 'Gym', lat: 2, lng: 2, days: [1, 2, 3] };
    coords = { lat: 2, lng: 2 };
    await rerender();
    expect(container.textContent).toContain('Gym');
    expect(container.textContent).not.toContain('Shooting Range');
  });
});
