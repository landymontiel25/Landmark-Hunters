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
vi.mock('./CheckInBlast', async () => {
  const { useEffect } = await import('react');
  function FakeBlast({ onDone }) {
    useEffect(() => {
      onDone();
    }, [onDone]);
    return null;
  }
  return { default: FakeBlast };
});
vi.mock('./tips/TipComposer', () => ({ default: () => <div>TIP COMPOSER</div> }));

import CheckInReview from './CheckInReview';
import { submitReview } from '../lib/reviews';

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

describe('CheckInReview background save errors', () => {
  it("don't show on the next check-in's modal", async () => {
    let rejectSave;
    submitReview.mockImplementation(() => new Promise((_, rej) => (rejectSave = rej)));
    checkInState.justCheckedIn = { id: 'lmA', name: 'Place A', region: 'r', categories: ['food'] };
    checkInState.checkInOptions = { ratingOnly: true, requireComment: false, initialTier: 'highly-recommend' };
    checkInState.commitCheckIn = async () => {};
    ratingsState.myReviews = {};
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<CheckInReview />));
    const post = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Post');
    await act(async () => post.click());
    expect(container.textContent).toContain('Rated!');
    // A new check-in opens before A's background save fails.
    checkInState.justCheckedIn = { id: 'lmB', name: 'Place B', region: 'r', categories: ['food'] };
    await act(async () => root.render(<CheckInReview />));
    await act(async () => rejectSave(new Error('offline')));
    expect(container.textContent).toContain('Place B');
    expect(container.textContent).not.toContain("couldn't save");
  });
});

describe('CheckInReview after a verified visit', () => {
  it('offers "Share a tip for others?" once posted, only when the server verified this visit', async () => {
    checkInState.justCheckedIn = { id: 'lm1', name: 'Test Cafe', region: 'r', categories: ['food'] };
    checkInState.checkInOptions = { ratingOnly: false, requireComment: false };
    checkInState.claimedMap = { lm1: true };
    checkInState.commitCheckIn = async () => ({ claimed: true, checkinId: 'me_lm1' });
    ratingsState.myReviews = { lm1: { ratingTier: 'highly-recommend', comment: '', highlights: [] } };
    const mount = async () => {
      const c = document.createElement('div');
      document.body.appendChild(c);
      await act(async () => createRoot(c).render(<CheckInReview />));
      await act(async () => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Post').click());
      await act(async () => {});
      return c;
    };
    checkInState.presenceResult = { verified: false, reason: 'too-far', landmarkId: 'lm1', checkinId: 'me_lm1' };
    expect((await mount()).textContent).not.toContain('Share a tip for others?');
    checkInState.presenceResult = { verified: true, landmarkId: 'lm1', checkinId: 'me_lm1' };
    const c = await mount();
    expect(c.textContent).toContain('Share a tip for others?');
    await act(async () => [...c.querySelectorAll('button')].find((b) => b.textContent.includes('Share a tip for others?')).click());
    expect(c.textContent).toContain('TIP COMPOSER');
  });
});
