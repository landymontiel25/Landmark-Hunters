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
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
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

describe('CheckInReview re-checking in at an already-rated place', () => {
  it('starts from the saved comment instead of a blank form', async () => {
    checkInState.checkInOptions = { ratingOnly: false, requireComment: false };
    ratingsState.myReviews = { lm1: { ratingTier: 'worth-trying', comment: 'Great espresso', highlights: [] } };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<CheckInReview />);
    });
    expect(container.querySelector('.rating-tier.selected')).toBeTruthy();
    expect(container.querySelector('textarea')?.value).toBe('Great espresso');
  });
});

describe('CheckInReview checking in at a place rated before visiting', () => {
  const mount = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<CheckInReview />);
    });
    return container;
  };

  it('asks you to confirm or change the earlier rating, pre-filled, and still requires Post', async () => {
    checkInState.checkInOptions = { ratingOnly: false, requireComment: false };
    checkInState.claimedMap = {};
    ratingsState.myReviews = { lm1: { ratingTier: 'probably-skip', comment: 'heard it was bad', visited: false } };
    const c = await mount();
    expect(c.textContent).toMatch(/You rated this before you visited/);
    expect(c.textContent).toMatch(/replaces the earlier one/);
    expect(c.querySelector('.rating-tier.selected').textContent).toContain("I didn't like it");
    const post = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Post');
    expect(post.disabled).toBe(false);
    // Switching to a different tier is what a fresh rating looks like.
    await act(async () => [...c.querySelectorAll('.rating-tier')].find((b) => b.textContent.includes('I loved it')).click());
    expect(c.querySelector('.rating-tier.selected').textContent).toContain('I loved it');
  });

  it('does not show that note once the place is already visited', async () => {
    checkInState.checkInOptions = { ratingOnly: false, requireComment: false };
    checkInState.claimedMap = { lm1: true };
    ratingsState.myReviews = { lm1: { ratingTier: 'worth-trying', comment: 'fine', visited: true } };
    const c = await mount();
    expect(c.textContent).not.toMatch(/You rated this before you visited/);
  });
});

describe('CheckInReview from Rate a Landmark on an unrateable place', () => {
  it('shows an error and does not claim a check-in', async () => {
    const commit = vi.fn();
    checkInState.justCheckedIn = { id: 'dorm1', name: 'Some Dorm', region: 'r', categories: ['campus'] };
    checkInState.checkInOptions = { ratingOnly: true, requireComment: true };
    checkInState.commitCheckIn = commit;
    ratingsState.myReviews = {};
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<CheckInReview />);
    });
    const btn = [...container.querySelectorAll('button')].find((b) => /Confirm check-in/.test(b.textContent));
    await act(async () => {
      btn.click();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("can't be rated");
    expect(container.textContent).not.toContain('Rated!');
  });
});
