// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/FriendsContext', () => ({
  useFriends: () => ({
    myProfile: {
      tagScores: { all: { food: 50 } },
      tagScoresAt: { all: { food: now } },
      swipeAnswers: [{ word: 'Pizza', answer: 'dislike' }],
    },
  }),
}));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
vi.mock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { activeRegion: 'miami' } }) }));
vi.mock('../lib/tasteScoreStore', () => ({ loadTasteSummary: async () => ({ state: 'ready', score: 55 }) }));

import TasteProfileLab from './TasteProfileLab';

let root;
let el;
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe('TasteProfileLab', () => {
  it('shows the renamed score as a link that opens the taste profile, and previews a comment', async () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root.render(<TasteProfileLab />));
    expect(el.textContent).toContain('Taste Match:');
    const link = el.querySelector('.taste-link');
    expect(link.textContent).toBe('55%');

    await act(async () => link.click());
    expect(el.textContent).toContain('Your taste profile');
    expect(el.textContent).toContain('You lean toward Food');
    expect(el.textContent).toContain('Pizza');

    const box = el.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => {
      setValue.call(box, 'I like coffee now');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.textContent).toContain('Show more Coffee');
  });
});
