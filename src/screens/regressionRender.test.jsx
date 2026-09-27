// @vitest-environment jsdom
//
// Mounts real screens (not just renders their markup once) with
// intentionally imperfect data -- a group trip missing a field, dorm
// buildings authored without every optional field -- and lets their
// effects actually run and settle, the same way a browser would. This is
// what caught the real regression: navigating from Itinerary to another
// tab was showing ErrorBoundary's "Something went wrong" because a
// component read an array field (trip.landmarkIds) that isn't guaranteed
// to exist on every stored document.
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'me', email: 'me@x.com' }, loading: false }),
}));
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

// Mounts `el`, lets effects (data arriving, subscriptions firing) settle,
// and fails the test with whatever React actually threw if the commit
// crashed -- the exact failure a real user sees as "Something went wrong".
async function mount(el) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(el);
  });
  return container;
}

describe('GroupTrip renders without crashing on real-world trip shapes', () => {
  const base = {
    id: 'g1',
    ownerUid: 'me',
    name: 'Villanova University Trip',
    regionId: 'villanova',
    memberUids: ['me', 'friend1'],
    memberNames: { me: 'landymontiel25', friend1: 'orlandomontiel' },
  };

  async function renderWith(trip) {
    vi.resetModules();
    vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
    vi.doMock('../lib/groupTrips', () => ({
      subscribeGroupTrip: (id, onData) => {
        onData(trip);
        return () => {};
      },
      toggleGroupLandmark: vi.fn(),
      setGroupLandmarks: vi.fn(),
      addGroupMember: vi.fn(),
      removeGroupMember: vi.fn(),
      deleteGroupTrip: vi.fn(),
      renameGroupTrip: vi.fn(),
      removeGroupPlace: vi.fn(),
    }));
    const { default: GroupTrip } = await import('./GroupTrip.jsx');
    const { TripProvider } = await import('../lib/TripContext');
    const { CheckInContext } = await import('../lib/CheckInContext');
    return mount(
      <TripProvider>
        <CheckInContext.Provider value={{ claimedMap: {} }}>
          <MemoryRouter initialEntries={['/group/g1']}>
            <Routes>
              <Route path="/group/:tripId" element={<GroupTrip />} />
            </Routes>
          </MemoryRouter>
        </CheckInContext.Provider>
      </TripProvider>
    );
  }

  it('a normal, fully-formed trip', async () => {
    const el = await renderWith({ ...base, landmarkIds: [], places: [] });
    expect(el.textContent).toContain('Villanova University Trip');
  });

  it('landmarkIds missing entirely (a doc that predates the field, or a partial write)', async () => {
    const el = await renderWith({ ...base, landmarkIds: undefined });
    expect(el.textContent).toContain('Shared Landmarks');
  });

  it('places missing entirely (a trip created before Mapr web-places existed)', async () => {
    const el = await renderWith({ ...base, landmarkIds: ['corr-hall-arch'], places: undefined });
    expect(el.textContent).toContain('Shared Landmarks');
  });

  it('a Mapr-found place missing lat/lng (a lookup that partially failed)', async () => {
    const el = await renderWith({ ...base, landmarkIds: [], places: [{ id: 'p1', name: 'Some Place' }] });
    expect(el.textContent).toContain('Some Place');
  });

  it('memberNames missing a member (they left, or a name backfill has not run)', async () => {
    const el = await renderWith({ ...base, landmarkIds: [], places: [], memberNames: { me: 'landymontiel25' } });
    expect(el.textContent).toContain('Members');
  });
});

describe('LandmarkSelection renders the real Villanova catalog (some entries ship without every optional field)', () => {
  async function renderIt(tripOverrides) {
    vi.resetModules();
    vi.doMock('../lib/TripContext', () => ({
      useTrip: () => ({
        trip: {
          activeRegion: 'villanova',
          visitFilter: [],
          interests: [],
          customInterests: [],
          customInterestMatches: {},
          customInterestEmoji: {},
          savedInterests: [],
          savedCustomInterests: [],
          deselectedCustomInterests: [],
          byRegion: {},
          itineraryNames: {},
          placesByRegion: {},
          ...tripOverrides,
        },
        toggleLandmark: vi.fn(),
        setRegionSelection: vi.fn(),
        getRegionSelection: (r) => (tripOverrides.byRegion || {})[r] || [],
        regionsWithItineraries: () => Object.keys(tripOverrides.byRegion || {}),
        clearRegion: vi.fn(),
        clearAll: vi.fn(),
        updateTrip: vi.fn(),
        setMapFocus: vi.fn(),
        setCustomInterestMatches: vi.fn(),
        setCustomInterestEmoji: vi.fn(),
      }),
    }));
    vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
    vi.doMock('../lib/useCheckIn', () => ({
      useCheckIn: () => ({ user: null, firebaseEnabled: false, claimedMap: {}, checkingIn: null, checkIn: vi.fn() }),
    }));
    vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ ratings: {} }) }));
    vi.doMock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ myPhotos: {} }) }));
    vi.doMock('../lib/LandmarkEditsContext', () => ({ useLandmarkEdits: () => ({ applyEdit: (l) => l }) }));
    vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '' }));
    vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: null, requests: [] }) }));
    const { default: LandmarkSelection } = await import('./LandmarkSelection.jsx');
    return mount(
      <MemoryRouter>
        <LandmarkSelection />
      </MemoryRouter>
    );
  }

  it('every Villanova landmark renders in the default (city-filtered) view', async () => {
    const el = await renderIt({});
    expect(el.textContent).toContain('Corr Hall Arch');
  });

  it('opens on every landmark, not a city saved from an earlier visit', async () => {
    const el = await renderIt({ activeRegion: 'san-francisco', activeRegionPicked: true });
    expect(el.querySelector('.city-dropdown-toggle').textContent).toContain('All Cities');
  });

  it('filtered to just Villanova, with one already on the itinerary (Select All path)', async () => {
    const el = await renderIt({ byRegion: { villanova: ['corr-hall-arch'] } });
    await act(async () => {
      el.querySelector('.city-dropdown-toggle').click();
    });
    const villanova = [...el.querySelectorAll('.city-dropdown-item')].find((b) => /villanova/i.test(b.textContent));
    await act(async () => {
      villanova.click();
    });
    expect(el.textContent).toContain('Select All');
  });
});
