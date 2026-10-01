// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Stable references, like the real contexts: a new object on every render
// would re-fire CheckInReview's reset effect forever.
const checkInState = {
  justCheckedIn: { id: 'lm1', name: 'Test Cafe', region: 'r', categories: ['food'] },
  checkInOptions: { ratingOnly: true, requireComment: false, initialTier: 'highly-recommend' },
  celebration: null,
  commitCheckIn: () => {},
  clearJustCheckedIn: () => {},
};
const authState = { user: { uid: 'me' } };
const friendsState = { myUsername: 'me' };
const ratingsState = { myReviews: {}, reload: () => {} };
const photosState = { reload: () => {} };
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => checkInState }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => friendsState }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ratingsState }));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => photosState }));
vi.mock('../lib/reviews', () => ({ submitReview: vi.fn(), ratingDraftKey: () => null }));
vi.mock('../lib/leaderboard', () => ({ attachCheckinPhoto: vi.fn() }));
vi.mock('../lib/imageUtils', () => ({ pickPhoto: vi.fn() }));

import CheckInReview from './CheckInReview';

describe('CheckInReview with a pre-picked tier (Mapr "How was it?")', () => {
  it('leaves Post enabled when the tier is already selected', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<CheckInReview />);
    });
    expect(container.querySelector('.rating-tier.selected')).toBeTruthy();
    const post = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Post');
    expect(post.disabled).toBe(false);
  });
});
