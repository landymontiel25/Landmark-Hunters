// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const h = vi.hoisted(() => ({ reviews: {}, summary: null, user: { uid: 'u1' } }));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('../lib/FriendsContext', () => ({
  useFriends: () => ({ profileFresh: true, myProfile: { tasteBaseline: { a: 1 } }, reload: () => {} }),
}));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: h.reviews }) }));
vi.mock('../lib/friends', () => ({ saveTasteBaseline: vi.fn(), saveTasteIntro: vi.fn() }));
vi.mock('../lib/tasteScoreStore', () => ({
  TASTE_ANSWER_EVENT: 'lh-taste-answer',
  loadTasteSummary: vi.fn(() => Promise.resolve(h.summary)),
  recordTasteAnswer: vi.fn(),
}));
vi.mock('./TasteNudgeCard', () => ({ default: () => null }));

import TasteProfileCard from './TasteProfileCard';
import * as store from '../lib/tasteScoreStore';

const DAY = 86400000;
const mk = (count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `p${i}`,
      { landmarkId: `p${i}`, region: 'r1', categories: ['food'], ratingTier: 'highly-recommend', ratedAt: Date.UTC(2026, 0, 1) + i * DAY },
    ])
  );

let root;
let host;
beforeEach(() => {
  h.summary = null;
  h.reviews = {};
  vi.clearAllMocks();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  host?.remove();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<TasteProfileCard />));
  await act(async () => {}); // let the live summary read settle
  return () => host.textContent;
}

describe('TasteProfileCard estimate', () => {
  it('shows the plain Learning... with no estimate', async () => {
    h.reviews = mk(3);
    const text = await mount();
    expect(text()).toContain('Learning...');
    expect(text()).not.toContain('estimated from your past ratings');
  });

  it('shows the estimate while live guesses are under the minimum, then the live score', async () => {
    h.reviews = mk(20);
    h.summary = { state: 'learning', score: null };
    const text = await mount();
    expect(text()).toContain('Mapr Score: ~99%');
    expect(text()).toContain('(estimated from your past ratings)');
    expect(text()).not.toContain('Learning...');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('lh-taste-answer', { detail: { state: 'ready', score: 62 } }));
    });
    expect(text()).toContain('Mapr Score: 62%');
    expect(text()).not.toContain('~');
    expect(text()).not.toContain('estimated from your past ratings');
  });

  it('writes nothing: no taste answer record / history snapshot is triggered', async () => {
    h.reviews = mk(20);
    const text = await mount();
    expect(text()).toContain('~99%');
    expect(store.recordTasteAnswer).not.toHaveBeenCalled();
  });

  it('shows a colored bar with the number: green when high, and red/yellow by score on the live score', async () => {
    h.reviews = mk(20);
    h.summary = { state: 'learning', score: null };
    await mount();
    const bar = () => host.querySelector('[role="progressbar"]');
    expect(bar().getAttribute('aria-valuenow')).toBe('99');
    expect(host.querySelector('.taste-bar-fill').className).toContain('taste-bar-green');
    expect(host.querySelector('.taste-bar-number').textContent).toBe('~99%');

    for (const [score, tone, word] of [[62, 'yellow', 'Getting there'], [25, 'red', 'Still learning you'], [80, 'green', 'Strong']]) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent('lh-taste-answer', { detail: { state: 'ready', score } }));
      });
      expect(host.querySelector('.taste-bar-fill').className).toContain(`taste-bar-${tone}`);
      expect(host.querySelector('.taste-bar-number').textContent).toBe(`${score}%`);
      expect(host.querySelector('.taste-bar-word').textContent).toBe(word);
    }
  });

  it('shows no bar while there is nothing to show yet', async () => {
    h.reviews = mk(3);
    await mount();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
  });
});
