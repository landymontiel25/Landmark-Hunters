// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const authState = { user: { uid: 'me' }, firebaseEnabled: true };
const ratingsState = { myReviews: {}, reload: async () => {} };
const submitReview = vi.fn(async () => ({}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ratingsState }));
vi.mock('../lib/reviews', () => ({ submitReview: (...a) => submitReview(...a), ratingDraftKey: () => null }));

import QuickRateButton from './QuickRateButton';

const landmark = { id: 'lm1', name: 'Test Cafe', region: 'r', categories: ['food'] };

describe('QuickRateButton', () => {
  it('offers rating without a check-in and saves a tier-only rating', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<QuickRateButton landmark={landmark} />));
    const pill = container.querySelector('.quick-rate-btn');
    expect(pill).toBeTruthy();
    await act(async () => pill.click());
    const save = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Save rating');
    expect(save().disabled).toBe(true); // no tier yet, so nothing (not even a comment) can be saved
    await act(async () =>
      [...document.body.querySelectorAll('.rating-tier')].find((b) => b.textContent.includes('Ok')).click()
    );
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'me', landmark, rating: expect.objectContaining({ tier: 'worth-trying' }) })
    );
  });
});
