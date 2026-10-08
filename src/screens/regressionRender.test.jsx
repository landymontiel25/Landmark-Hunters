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
    vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ ratings: {} }) }));
    vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '' }));
    vi.doMock('../lib/groupTrips', () => ({
      subscribeGroupTrip: (id, onData) => {
        onData(trip);
        return () => {};
      },
      toggleGroupLandmark: vi.fn(),
      setGroupLandmarks: vi.fn(),
      reorderGroupLandmarks: vi.fn(),
      addGroupMember: vi.fn(),
      removeGroupMember: vi.fn(),
      deleteGroupTrip: vi.fn(),
      renameGroupTrip: vi.fn(),
      removeGroupPlace: vi.fn(),
      MAX_GROUP_MEMBERS: 25,
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
    expect(el.textContent).toContain('Add Landmarks');
  });

  it('places missing entirely (a trip created before Mapr web-places existed)', async () => {
    const el = await renderWith({ ...base, landmarkIds: ['corr-hall-arch'], places: undefined });
    expect(el.textContent).toContain('Add Landmarks');
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
    // Rows fill in a chunk per frame (so ~870 rows don't block first paint).
    const initial = el.querySelectorAll('.landmark-row').length;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(800);
    // Keep waiting until the row count stops growing, so the catalog can keep growing.
    let last = -1;
    for (let i = 0; i < 400; i++) {
      const now = el.querySelectorAll('.landmark-row').length;
      if (now > 800 && now === last) break;
      last = now;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    expect(el.querySelectorAll('.landmark-row').length).toBeGreaterThan(800);
    expect(el.textContent).toContain('Corr Hall Arch');
  }, 40000);

  it('opens on every landmark, not a city saved from an earlier visit', async () => {
    const el = await renderIt({ activeRegion: 'san-francisco', activeRegionPicked: true });
    expect(el.querySelector('.city-dropdown-toggle').textContent).toContain('All Cities');
  }, 30000);

  it('filtered to just Villanova, with one already on the itinerary (no Select All button)', async () => {
    const el = await renderIt({ byRegion: { villanova: ['corr-hall-arch'] } });
    await act(async () => {
      el.querySelector('.city-dropdown-toggle').click();
    });
    const villanova = [...el.querySelectorAll('.city-dropdown-item')].find((b) => /villanova/i.test(b.textContent));
    await act(async () => {
      villanova.click();
    });
    expect(el.textContent).not.toContain('Select All');
    expect(el.textContent).not.toContain('Suggest For Me');
  }, 30000);
});

describe('MapExplore shows "Picked for you right now" over the live map', () => {
  const CAMPUS = { lat: 40.0375, lng: -75.3421 }; // Villanova's campus
  async function renderMap({ coords = CAMPUS, geoError = null, ratingsCount = 12, reviewsLoaded = true } = {}) {
    vi.resetModules();
    const myReviews = Object.fromEntries(
      Array.from({ length: ratingsCount }, (_, i) => [`r${i}`, { landmarkId: `r${i}`, ratingTier: 'worth-trying' }])
    );
    const logRecommendations = vi.fn(async () => []);
    vi.doMock('../lib/TripContext', () => ({
      useTrip: () => ({
        trip: { byRegion: {}, activeRegion: null },
        toggleLandmark: vi.fn(),
        getRegionSelection: () => [],
        mapFocus: null,
        mapFocusPoint: null,
        setMapFocusPoint: vi.fn(),
        mapFocusStops: null,
      }),
    }));
    vi.doMock('../lib/useCheckIn', () => ({
      useCheckIn: () => ({ user: { uid: 'me', email: 'me@x.com' }, firebaseEnabled: true, claimedMap: {}, checkingIn: null, checkIn: vi.fn() }),
    }));
    vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords, error: geoError, loading: false, lastKnown: null }) }));
    vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ ratings: {}, myReviews, myReviewsLoaded: reviewsLoaded }) }));
    vi.doMock('../lib/FriendsContext', () => ({
      useFriends: () => ({
        myProfile: { tagScores: { villanova: { 'history-culture': 40, food: 20 } }, tagCounts: { villanova: { 'history-culture': 8, food: 5 } } },
      }),
    }));
    vi.doMock('../lib/AdminModeContext', () => ({ useAdminMode: () => ({ adminMode: false }) }));
    vi.doMock('../lib/LandmarkEditsContext', () => ({ useLandmarkEdits: () => ({ applyEdit: (l) => l }) }));
    vi.doMock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ myPhotos: {} }) }));
    vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '1 mi' }));
    vi.doMock('../lib/landmarkOverrides', () => ({ getLandmarkOverrides: async () => ({}), saveLandmarkPosition: vi.fn() }));
    vi.doMock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => [], deleteCustomLandmark: vi.fn(), updateCustomLandmark: vi.fn() }));
    vi.doMock('../lib/leaderboard', () => ({ getUserCheckins: async () => [], isRealCheckin: () => true }));
    vi.doMock('../lib/pickReasonsApi', () => ({ fetchPickReasons: async () => ({}) }));
    vi.doMock('../lib/recommendationLog', () => ({ logRecommendations, logShownPicks: vi.fn(async () => 0), makeSetId: () => 'set' }));
    vi.doMock('../components/OnboardingBanner', () => ({ default: () => null }));
    const { default: MapExplore } = await import('./MapExplore.jsx');
    const el = await mount(
      <MemoryRouter>
        <MapExplore />
      </MemoryRouter>
    );
    return { el, logRecommendations };
  }

  it('opens on the picks sheet over the real map, with no preview controls', async () => {
    const { el } = await renderMap();
    expect(el.querySelector('.leaflet-container')).toBeTruthy();
    const sheet = el.querySelector('.map-picks .mpp-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain('Picked for you right now');
    expect(el.querySelector('.map-fullscreen').classList.contains('has-picks')).toBe(true);
    expect(el.textContent).not.toMatch(/Preview as|Simulate location/);
    expect(el.querySelector('.mpp-phone')).toBeNull();
    localStorage.clear();
  });

  it('asks a new account for ratings, and asks for location when it is off', async () => {
    expect((await renderMap({ ratingsCount: 3 })).el.textContent).toContain('Rate 7 more places and Mapr will start picking for you.');
    document.body.removeChild(container);
    container = null;
    const { el } = await renderMap({ coords: null, geoError: 'Location permission denied' });
    expect(el.querySelector('.map-picks').textContent).toContain('Turn on location to see picks near you.');
  });

  it("waits for the account's ratings before showing anything", async () => {
    const { el } = await renderMap({ reviewsLoaded: false });
    expect(el.querySelector('.map-picks')).toBeNull();
    expect(el.querySelector('.map-fullscreen').classList.contains('has-picks')).toBe(false);
  });
});
