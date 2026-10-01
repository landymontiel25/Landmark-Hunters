// @vitest-environment jsdom
//
// Rating section of the landmark page:
//  - a place you rated through "Rate a Landmark" (a 0-point claim, not
//    counted as checked in) still shows the rating form, so it can be edited;
//  - an existing rating can be removed from here;
//  - adding a photo after a save re-enables the save button, so a photo that
//    failed to upload can be retried.
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
    ratings: { ratings: {}, myReviews: { 'south-beach': { ratingTier: 'highly-recommend' } }, reload: asyncNoop },
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
  getMyReview: vi.fn().mockResolvedValue({
    ratingTier: 'highly-recommend',
    stars: 5,
    highlights: [],
    lovedOrder: [],
    dislikedOrder: [],
    comment: 'Great',
  }),
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
      <MemoryRouter initialEntries={['/landmarks/miami/south-beach']}>
        <Routes>
          <Route path="/landmarks/:region/:id" element={<LandmarkDetail />} />
        </Routes>
      </MemoryRouter>
    );
  });
  // Let the review/comment reads settle.
  await act(async () => {});
  return container;
}

const btn = (c, re) => [...c.querySelectorAll('button')].find((b) => re.test(b.textContent));
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('landmark page rating section', () => {
  it('lets you edit a rating made through Rate a Landmark (no real check-in)', async () => {
    claimed = {};
    const c = await mountPage();
    expect(c.textContent).not.toMatch(/Check in here first to rate it/);
    expect(c.textContent).toMatch(/Already rated/);
    expect(btn(c, /Update Rating/)).toBeTruthy();
  });

  it('still asks you to check in first when there is no rating and no check-in', async () => {
    claimed = {};
    const rv = await import('../lib/reviews');
    const saved = stable.ratings.myReviews;
    const had = await rv.getMyReview();
    stable.ratings.myReviews = {};
    rv.getMyReview.mockResolvedValue(null);
    try {
      const c = await mountPage();
      expect(c.textContent).toMatch(/Check in here first to rate it/);
    } finally {
      stable.ratings.myReviews = saved;
      rv.getMyReview.mockResolvedValue(had);
    }
  });

  it('removes your rating from the page', async () => {
    claimed = { 'south-beach': true };
    deleteMyReview.mockResolvedValue(undefined);
    const c = await mountPage();
    await click(btn(c, /Remove my rating/));
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteMyReview).toHaveBeenCalledWith('me', 'south-beach');
    expect(c.textContent).not.toMatch(/Already rated/);
  });

  it('does not delete when the confirmation is declined', async () => {
    claimed = { 'south-beach': true };
    window.confirm = vi.fn(() => false);
    const c = await mountPage();
    await click(btn(c, /Remove my rating/));
    expect(deleteMyReview).not.toHaveBeenCalled();
  });

  it('re-enables saving after a save when a new photo is added', async () => {
    claimed = { 'south-beach': true };
    submitReview.mockResolvedValue({ photoURLs: [], photoFailed: true });
    const c = await mountPage();
    await click(btn(c, /Update Rating/));
    expect(btn(c, /Rating updated/).disabled).toBe(true);
    await click(btn(c, /Add photo \(0\/3\)/));
    const save = btn(c, /Update Rating/);
    expect(save).toBeTruthy();
    expect(save.disabled).toBe(false);
  });

  it('keeps the photo cap when re-reading your review fails after a save', async () => {
    claimed = { 'south-beach': true };
    const rv = await import('../lib/reviews');
    const full = {
      ratingTier: 'highly-recommend',
      stars: 5,
      highlights: [],
      lovedOrder: [],
      dislikedOrder: [],
      comment: 'Great',
      photoURLs: ['a', 'b', 'c'],
    };
    let offline = false;
    rv.getMyReview.mockImplementation(() => (offline ? Promise.reject(new Error('offline')) : Promise.resolve(full)));
    submitReview.mockResolvedValue({ photoURLs: ['a', 'b', 'c'] });
    const c = await mountPage();
    expect(btn(c, /Add photo \(\d+\/3\)/)).toBeFalsy();
    offline = true;
    await click(btn(c, /Update Rating/));
    await act(async () => {});
    expect(btn(c, /Add photo \(\d+\/3\)/)).toBeFalsy();
  });
});
