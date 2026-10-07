// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A slow read for account A must not land after the user switched to B.
const authState = { current: { user: { uid: 'A' }, firebaseEnabled: true } };
const pending = {};
function deferred(key) {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  pending[key] = resolve;
  return p;
}
vi.mock('./AuthContext', () => ({ useAuth: () => authState.current }));
vi.mock('./firebase', () => ({ firebaseEnabled: true }));
vi.mock('./reviews', () => ({
  getAllRatings: async () => ({}),
  getUserReviews: (uid) => deferred(`reviews-${uid}`),
  getUserReviewPhotos: (uid) => deferred(`photos-${uid}`),
}));
vi.mock('./leaderboard', () => ({ getUserCheckins: async () => [] }));

import { RatingsProvider, useRatings } from './RatingsContext';
import { MyPhotosProvider, useMyPhotos } from './MyPhotosContext';

let seen;
function Probe() {
  const { myReviews } = useRatings();
  const { myPhotos } = useMyPhotos();
  seen = { reviews: Object.keys(myReviews), photos: Object.keys(myPhotos) };
  return null;
}

describe('RatingsContext / MyPhotosContext account switch', () => {
  it("ignores a late result for the previous account", async () => {
    const root = createRoot(document.createElement('div'));
    const tree = () => (
      <RatingsProvider>
        <MyPhotosProvider>
          <Probe />
        </MyPhotosProvider>
      </RatingsProvider>
    );
    await act(async () => root.render(tree()));
    authState.current = { user: { uid: 'B' }, firebaseEnabled: true };
    await act(async () => root.render(tree()));
    await act(async () => {
      pending['reviews-B']?.([{ landmarkId: 'b-place' }]);
      pending['photos-B']?.({ 'b-place': ['b.jpg'] });
    });
    await act(async () => {
      pending['reviews-A']?.([{ landmarkId: 'a-place' }]);
      pending['photos-A']?.({ 'a-place': ['a.jpg'] });
    });
    expect(seen.reviews).toEqual(['b-place']);
    expect(seen.photos).toEqual(['b-place']);
  });
});
