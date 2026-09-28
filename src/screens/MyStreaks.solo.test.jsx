// @vitest-environment jsdom
// Solo-streak-focused tests, separate from MyStreaks.test.jsx's dual-streak
// mocks: here the solo streak is a real doc and there are zero dual
// streaks, so the unified list, the solo detail's rate-only flow (no guess
// step), and the invite-to-dual handoff can all be exercised for real.
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const soloStreak = {
  id: 'me',
  mode: 'solo',
  memberIds: ['me'],
  memberNames: { me: 'me' },
  cityId: 'miami',
  count: 4,
  best: 6,
  freezesLeft: 1,
  freezeMonth: '2026-9',
  createdAt: { seconds: 0 },
};

// Mutable so individual tests can render with/without dual streaks alongside
// the solo one, without re-hoisting a fresh vi.mock per test.
let currentDualStreaks = [];
let fakeEntry = { uid: 'me', ratings: {} };
let entryListener = null;
const notifyEntry = () => entryListener?.({ ...fakeEntry });
const submitSoloCardRatingMock = vi.fn(async (id, landmarkId, verdict) => {
  fakeEntry.ratings[landmarkId] = verdict;
  notifyEntry();
});
const closeSoloTodayMock = vi.fn(async () => ({ ok: true, closed: true, already: false, count: 5, pointsAwarded: 20, milestoneAwarded: 0 }));
const spendSoloFreezeMock = vi.fn(async () => ({ freezesLeft: 0 }));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19 } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/PairStreakContext', () => ({
  usePairStreaks: () => ({ streaks: currentDualStreaks, leaveStreak: vi.fn(), startStreakWith: vi.fn(), closeToday: vi.fn() }),
}));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: vi.fn(async () => ({})),
  subscribeMySoloStreak: (uid, onStreak) => {
    onStreak(soloStreak);
    return () => {};
  },
  setSoloStreakCity: vi.fn(),
  submitSoloCardRating: (...args) => submitSoloCardRatingMock(...args),
  subscribeSoloDayEntry: (uid, dayId, onEntry) => {
    entryListener = onEntry;
    onEntry({ ...fakeEntry });
    return () => {
      entryListener = null;
    };
  },
  closeSoloToday: (...args) => closeSoloTodayMock(...args),
  spendSoloFreeze: (...args) => spendSoloFreezeMock(...args),
  SOLO_FREEZES_PER_MONTH: 1,
}));
vi.mock('../lib/pairStreaks', () => ({
  subscribeDayEntries: (pairId, dayId, onEntries) => {
    onEntries({});
    return () => {};
  },
  setStreakCity: vi.fn(async () => {}),
  submitCardRating: vi.fn(async () => {}),
  submitCardGuess: vi.fn(async () => false),
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
  currentDualStreaks = [];
  fakeEntry = { uid: 'me', ratings: {} };
  entryListener = null;
  submitSoloCardRatingMock.mockClear();
  closeSoloTodayMock.mockClear();
  spendSoloFreezeMock.mockClear();
});

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <MyStreaks />
      </MemoryRouter>
    )
  );
};

describe('MyStreaks - solo streak', () => {
  it('shows the solo streak directly on the default Solo tab, no extra tap needed', async () => {
    await render();
    expect(container.textContent).toContain('Your Solo Streak');
  });

  it('keeps solo and dual apart as separate tabs, not mixed into one list', async () => {
    currentDualStreaks = [
      {
        id: 'me_friend',
        memberIds: ['me', 'friend'],
        memberNames: { me: 'me', friend: 'buddy' },
        cityId: 'miami',
        count: 2,
        best: 5,
        freezesLeft: 2,
        freezeMonth: '2026-8',
        createdAt: { seconds: 0 },
      },
    ];
    await render();
    // Solo tab (default) shows the solo streak, not the dual one.
    expect(container.textContent).toContain('Your Solo Streak');
    expect(container.textContent).not.toContain('@buddy');

    const dualTab = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Dual'));
    await act(async () => dualTab.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('@buddy');
    expect(container.textContent).not.toContain('Your Solo Streak');
  });

  it('lets you rate 3 cards with no guess step, closing the day', async () => {
    await render();

    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const voteBtn = container.querySelector('.mapr-pick-vote.love');
      await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    // No guess step exists for solo -- rating all 3 finishes the day outright.
    expect(container.querySelector('.streak-guess-banner')).toBeFalsy();
    expect(container.textContent).toContain("You've rated all 3 today");
    expect(closeSoloTodayMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('+20 pts');
  });

  it('opens the dual streak picker from the solo detail\'s invite button, without touching the solo count', async () => {
    await render();

    const inviteBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Start a Dual Streak'));
    await act(async () => inviteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('Start a Streak');
    expect(container.textContent).toContain("Pick a friend");
  });
});
