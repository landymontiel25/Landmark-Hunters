// @vitest-environment jsdom
// Smoke-render test: mounts MyStreaks with a real cityId set, the exact
// path that crashed in production with "can't find variable getRegion"
// (a missing import that neither vitest's other suites nor `npm run build`
// catches, since Vite doesn't type-check and nothing else exercised this
// component's render). A real mount would have caught it immediately.
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const streak = {
  id: 'me_friend',
  memberIds: ['me', 'friend'],
  memberNames: { me: 'me', friend: 'buddy' },
  cityId: 'miami',
  count: 2,
  best: 5,
  freezesLeft: 2,
  freezeMonth: '2026-8',
  createdAt: { seconds: 0 },
};

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/PairStreakContext', () => ({
  usePairStreaks: () => ({ streaks: [streak], leaveStreak: vi.fn(), startStreakWith: vi.fn(), closeToday: vi.fn() }),
}));
vi.mock('../lib/pairStreaks', () => ({
  subscribeDayEntries: () => () => {},
  setStreakCity: vi.fn(),
  submitCardRating: vi.fn(),
  submitCardGuess: vi.fn(),
  spendFreeze: vi.fn(),
  completeRecoveryMission: vi.fn(),
  computeCompatibility: async () => ({ sharedCount: 0, score: null }),
  MAX_ACTIVE_STREAKS: 3,
  FREEZES_PER_MONTH: 2,
}));
vi.mock('../lib/leaderboard', () => ({ getUserCheckedInLandmarkIds: async () => [] }));
vi.mock('../lib/friends', () => ({ listFriends: async () => [] }));

import MyStreaks from './MyStreaks';

let container;
afterEach(() => {
  document.body.removeChild(container);
});

describe('MyStreaks', () => {
  it('renders a streak with a city set without crashing, and shows the deck', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <MyStreaks />
        </MemoryRouter>
      )
    );
    // MyStreaks opens on the list of streaks; tap into the one streak to
    // reach the detail view (the code path that used getRegion).
    const row = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('@buddy'));
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Let the async check-in/compatibility fetches resolve.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("Today's 3 shared landmarks");
    expect(container.textContent).not.toContain('Something went wrong');
    expect(container.querySelectorAll('.mapr-pick-name').length).toBeGreaterThan(0);
  });
});
