// @vitest-environment jsdom
// Owner ask 2026-10-28: the Itinerary tab has two sub-tabs, Itineraries and
// Favorites, and Favorites filters by city.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  fav: {
    favorites: [
      { region: 'miami', id: 'vizcaya', name: 'Vizcaya', lat: 25.7, lng: -80.2, note: 'Go at sunset', savedAt: 2 },
      { region: 'rome', id: 'pizzeria-x', name: 'Pizzeria X', lat: 41.9, lng: 12.5, note: 'Great pizza', savedAt: 3 },
    ],
    ready: true,
    signedIn: true,
    add: async () => {},
    remove: async () => {},
    setNote: async () => {},
  },
  user: { uid: 'me' },
  geo: { coords: null },
  checkIn: null,
  friends: { myUsername: 'me' },
  photos: { myPhotos: {} },
  ratings: { ratings: {} },
  units: { units: 'imperial' },
  toast: { show: () => 0, dismiss: () => {} },
}));
h.checkIn = { user: h.user, firebaseEnabled: true, claimedMap: {}, checkingIn: false, checkIn: () => {} };
const auth = { user: h.user, loading: false };
vi.mock('../lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../lib/FavoritesContext', () => ({ useFavorites: () => h.fav }));
vi.mock('../lib/ToastContext', async (orig) => ({ ...(await orig()), useToast: () => h.toast }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => h.geo }));
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => h.checkIn }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => h.friends }));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => h.photos }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => h.ratings }));
vi.mock('../lib/UnitsContext', () => ({ useUnits: () => h.units, formatDistance: () => '' }));
vi.mock('../lib/groupTrips', () => ({ listMyGroupTrips: async () => [], createGroupTrip: vi.fn(), MAX_GROUP_MEMBERS: 25 }));
vi.mock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => [] }));
vi.mock('react-leaflet', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return { MapContainer: Stub, TileLayer: Stub, Marker: Stub, Popup: Stub, Polyline: Stub, CircleMarker: Stub, useMap: () => ({}) };
});

let container;
afterEach(() => {
  container?.remove();
  localStorage.clear();
});

async function render(entry = '/itinerary') {
  const { default: Itinerary } = await import('./Itinerary.jsx');
  const { TripProvider } = await import('../lib/TripContext');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter initialEntries={[entry]}>
        <TripProvider>
          <Itinerary />
        </TripProvider>
      </MemoryRouter>
    )
  );
  return container;
}
const tab = (el, label) => [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(label));

describe('Itinerary sub-tabs', () => {
  it('opens on Itineraries; Favorites shows every favorite and filters by city', async () => {
    const el = await render();
    expect(tab(el, 'Itineraries').getAttribute('aria-selected')).toBe('true');
    expect(tab(el, 'Favorites').textContent).toContain('(2)');
    expect(el.textContent).not.toContain('Vizcaya');

    await act(async () => tab(el, 'Favorites').click());
    expect(tab(el, 'Favorites').getAttribute('aria-selected')).toBe('true');
    expect(el.textContent).toContain('Vizcaya');
    expect(el.textContent).toContain('Pizzeria X');

    const select = el.querySelector('select[aria-label="Filter by city"]');
    await act(async () => {
      select.value = 'Miami';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.textContent).toContain('Vizcaya');
    expect(el.textContent).not.toContain('Pizzeria X');

    await act(async () => tab(el, 'Itineraries').click());
    expect(el.textContent).not.toContain('Vizcaya');
  });

  it('arriving from the /favorites redirect opens Favorites', async () => {
    const el = await render({ pathname: '/itinerary', state: { section: 'favorites' } });
    expect(tab(el, 'Favorites').getAttribute('aria-selected')).toBe('true');
    expect(el.textContent).toContain('Vizcaya');
  });
});
