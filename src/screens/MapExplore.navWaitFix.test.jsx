// @vitest-environment jsdom
//
// Directions asked for before the first GPS fix: a slow GPS reports a watch
// timeout first, which ended the request with "Turn on location" and it
// never retried when the fix came in a few seconds later.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSyncExternalStore } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../lib/ToastContext', async (orig) => ({
  ...(await orig()),
  useToast: () => ({ show: () => 0, dismiss: () => {} }),
}));

let container;
afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
});

// A tiny external store standing in for GeoContext, so the test can feed a
// late fix and have MapExplore re-render the way the real provider would.
let geo = { coords: null, error: 'Location timed out', loading: false, lastKnown: null };
const listeners = new Set();
const setGeo = (next) => {
  geo = next;
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

describe('MapExplore directions before the first GPS fix', () => {
  it('routes once a fix arrives after the GPS timed out', async () => {
    vi.resetModules();
    const fetchDirections = vi.fn(async () => ({ mode: 'WALK', points: [[40, -75], [40.001, -75]], steps: [], durationSeconds: 60, distanceMeters: 100 }));
    vi.doMock('../lib/routing', async (orig) => ({ ...(await orig()), fetchDirections }));
    vi.doMock('../lib/GeoContext', () => ({ useGeo: () => useSyncExternalStore(subscribe, () => geo) }));
    vi.doMock('../lib/TripContext', () => ({
      useTrip: () => ({
        trip: { byRegion: {}, activeRegion: null },
        toggleLandmark: vi.fn(),
        removeLandmark: vi.fn(),
        getRegionSelection: () => [],
        mapFocus: null,
        mapFocusPoint: null,
        setMapFocusPoint: vi.fn(),
        mapFocusStops: null,
      }),
    }));
    vi.doMock('../lib/useCheckIn', () => ({
      useCheckIn: () => ({ user: null, firebaseEnabled: false, claimedMap: {}, checkingIn: null, checkIn: vi.fn() }),
    }));
    vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ ratings: {}, myReviews: {}, myReviewsLoaded: false }) }));
    vi.doMock('../lib/AdminModeContext', () => ({ useAdminMode: () => ({ adminMode: false }) }));
    vi.doMock('../lib/LandmarkEditsContext', () => ({ useLandmarkEdits: () => ({ applyEdit: (l) => l }) }));
    vi.doMock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ myPhotos: {} }) }));
    vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '1 mi' }));
    vi.doMock('../lib/landmarkOverrides', () => ({ getLandmarkOverrides: async () => ({}), saveLandmarkPosition: vi.fn() }));
    vi.doMock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => [], deleteCustomLandmark: vi.fn(), updateCustomLandmark: vi.fn() }));
    vi.doMock('../components/OnboardingBanner', () => ({ default: () => null }));
    const { default: MapExplore } = await import('./MapExplore.jsx');

    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const dest = { name: 'Old Main', lat: 40.001, lng: -75 };
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[{ pathname: '/', state: { directionsTo: dest } }]}>
          <MapExplore />
        </MemoryRouter>
      );
    });
    expect(container.textContent).toContain('Turn on location to get directions on the map.');
    expect(fetchDirections).not.toHaveBeenCalled();

    await act(async () => {
      setGeo({ coords: { lat: 40, lng: -75, accuracy: 10 }, error: null, loading: false, lastKnown: null });
    });
    expect(fetchDirections).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Turn on location to get directions on the map.');
    expect(container.textContent).toContain('To Old Main');
    root.unmount();
  }, 30000);
});
