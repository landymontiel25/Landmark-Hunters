// @vitest-environment jsdom
//
// An imported (OSM) place opened by link before its chunk has loaded: the page
// waits for the chunk, then shows the place with its facts, the OSM credit,
// check-in and rating. A chunk that fails to load offers Try again instead of
// treating the place as deleted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const submitReview = vi.fn();
const deleteMyReview = vi.fn();
let claimed = {};

vi.mock('../lib/useCheckIn', () => ({
  useCheckIn: () => ({ user: stable.user, firebaseEnabled: true, claimedMap: claimed, checkingIn: null, checkIn: stable.checkIn.checkIn }),
}));
vi.mock('../lib/AdminModeContext', () => ({ useAdminMode: () => stable.admin }));
// Stable references: the page keys effects off these, so a fresh function on
// every render would loop forever.
const stable = vi.hoisted(() => {
  const noop = () => {};
  const asyncNoop = () => Promise.resolve(undefined);
  return {
    edits: { applyEdit: (l) => l, reload: noop },
    ratings: { ratings: {}, myReviews: {}, reload: asyncNoop },
    photos: { reload: asyncNoop },
    friends: { myUsername: 'me', friendUids: [] },
    trip: { toggleLandmark: noop, removeLandmark: noop, getRegionSelection: () => [], updateTrip: noop, setMapFocus: noop, setMapFocusPoint: noop },
    toast: { show: () => 0, dismiss: noop },
    geo: { coords: null },
    admin: { adminMode: false },
    checkIn: { checkIn: noop },
    user: { uid: 'me', email: 'me@x.com' },
  };
});
vi.mock('../lib/LandmarkEditsContext', () => ({ useLandmarkEdits: () => stable.edits }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => stable.geo }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => stable.ratings }));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => stable.photos }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => stable.friends }));
vi.mock('../lib/TripContext', () => ({ useTrip: () => stable.trip }));
vi.mock('../lib/ToastContext', () => ({
  useToast: () => stable.toast,
  // Runs apply + commit like the real one, minus the toast.
  runOptimistic: async ({ apply, commit, rollback }) => {
    apply();
    try {
      await commit();
    } catch {
      rollback();
    }
  },
}));
vi.mock('../lib/imageUtils', () => ({ pickPhoto: vi.fn().mockResolvedValue(new File(['x'], 'p.jpg', { type: 'image/jpeg' })) }));
const packs = vi.hoisted(() => ({ ok: true, place: null }));
vi.mock('../lib/placePacks', async () => {
  const { registerPlaces, getCatalogVersion, subscribeCatalog } = await import('../data/regions');
  const { useSyncExternalStore } = await import('react');
  return {
    isPlacePackId: (id) => String(id).startsWith('osm-'),
    ensurePlacePacks: vi.fn(async () => {
      if (packs.ok) registerPlaces([packs.place]);
      return packs.ok;
    }),
    usePlacePacksVersion: () => useSyncExternalStore(subscribeCatalog, getCatalogVersion, getCatalogVersion),
  };
});
const getCustomLandmark = vi.fn();
vi.mock('../lib/customLandmarks', async (orig) => ({ ...(await orig()), getCustomLandmark: (...a) => getCustomLandmark(...a) }));
vi.mock('../lib/blocks', () => ({ blockUser: vi.fn(), listBlockedUsers: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/leaderboard', () => ({
  getMyCheckin: vi.fn().mockResolvedValue(null),
  getVisitCount: vi.fn().mockResolvedValue(0),
  addCheckinPhoto: vi.fn(),
  removeCheckinPhoto: vi.fn(),
  updateCheckinTimestamp: vi.fn(),
  MAX_CHECKIN_PHOTOS: 9,
}));
vi.mock('../lib/reviews', () => ({
  submitReview: (...a) => submitReview(...a),
  deleteMyReview: (...a) => deleteMyReview(...a),
  getMyReview: vi.fn().mockResolvedValue(null),
  getLandmarkReviews: vi.fn().mockResolvedValue([]),
  reportReview: vi.fn(),
  ratingDraftKey: () => null,
  MAX_REVIEW_PHOTOS: 3,
}));

vi.setConfig({ testTimeout: 60000 });
let container;
beforeEach(() => {
  submitReview.mockReset();
  deleteMyReview.mockReset();
  window.confirm = vi.fn(() => true);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  if (container) document.body.removeChild(container);
  container = null;
});

async function mountPage() {
  const { default: LandmarkDetail } = await import('./LandmarkDetail.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/landmarks/miami/osm-n424242']}>
        <Routes>
          <Route path="/landmarks/:region/:id" element={<LandmarkDetail />} />
        </Routes>
      </MemoryRouter>
    );
  });
  // Let the chunk load and the review/comment reads settle.
  await act(async () => {});
  await act(async () => {});
  return container;
}


import { toPlace } from '../../scripts/osm-import/transform.js';

const place = toPlace({
  type: 'node',
  id: 424242,
  lat: 25.7652,
  lon: -80.2199,
  tags: { amenity: 'restaurant', name: 'Fixture Cuban Kitchen', cuisine: 'cuban', outdoor_seating: 'yes', 'addr:street': 'Southwest 8th Street' },
});

describe('imported place page', () => {
  it('shows a place that arrives with its chunk', async () => {
    packs.ok = false;
    const offline = await mountPage();
    expect(offline.textContent).toMatch(/Try again|couldn.t|Could not/i);
    expect(getCustomLandmark).not.toHaveBeenCalled();
    document.body.removeChild(container);
    container = null;

    packs.ok = true;
    packs.place = place;
    const c = await mountPage();
    expect(c.textContent).toMatch(/Fixture Cuban Kitchen/);
    expect(c.textContent).toMatch(/Cuban restaurant on Southwest 8th Street/);
    expect(c.textContent).toMatch(/Serves Cuban food/);
    expect(c.textContent).toMatch(/Has outdoor seating/);
    expect(c.textContent).toMatch(/OpenStreetMap contributors/);
    expect(c.querySelector('a[href="https://www.openstreetmap.org/node/424242"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Rate this place/);
    expect(c.textContent).toMatch(/Do you like Cuban food\?/);
    expect(c.textContent).not.toMatch(/Needs a ticket/);
    expect(getCustomLandmark).not.toHaveBeenCalled();
  });
});
