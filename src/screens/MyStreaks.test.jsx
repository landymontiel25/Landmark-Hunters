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
// Mutable so different tests can render a streak with/without a cityId
// already set, without re-hoisting a fresh vi.mock per test.
let currentStreaks = [streak];

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19 } }) }));
vi.mock('../lib/PairStreakContext', () => ({
  usePairStreaks: () => ({ streaks: currentStreaks, leaveStreak: vi.fn(), startStreakWith: vi.fn(), closeToday: vi.fn() }),
}));
const setStreakCityMock = vi.fn(async () => {});
// A minimal fake of Firestore's real behavior (write, then the snapshot
// listener fires with the new state) -- needed for the rate -> guess ->
// "card leaves the carousel" flow to actually exercise real state, not
// just call mocked functions that go nowhere.
let fakeEntries = {};
let entriesListener = null;
const notifyEntries = () => entriesListener?.({ ...fakeEntries });
vi.mock('../lib/pairStreaks', () => ({
  subscribeDayEntries: (pairId, dayId, onEntries) => {
    entriesListener = onEntries;
    onEntries({ ...fakeEntries });
    return () => {
      entriesListener = null;
    };
  },
  setStreakCity: (...args) => setStreakCityMock(...args),
  submitCardRating: async (pairId, uid, landmarkId, verdict) => {
    fakeEntries[uid] = fakeEntries[uid] || { uid, ratings: {}, guesses: {} };
    fakeEntries[uid].ratings[landmarkId] = verdict;
    notifyEntries();
  },
  submitCardGuess: async (pairId, uid, landmarkId, verdict, cardIds) => {
    fakeEntries[uid] = fakeEntries[uid] || { uid, ratings: {}, guesses: {} };
    fakeEntries[uid].guesses[landmarkId] = verdict;
    notifyEntries();
    return (cardIds || []).every((id) => fakeEntries[uid].ratings[id] && fakeEntries[uid].guesses[id]);
  },
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
  currentStreaks = [streak];
  setStreakCityMock.mockClear();
  fakeEntries = {};
  entriesListener = null;
});

const openStreak = async () => {
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe('MyStreaks', () => {
  it('renders a streak with a city set without crashing, shows the deck as a carousel', async () => {
    await openStreak();
    expect(container.textContent).toContain("Today's 3 shared landmarks");
    expect(container.textContent).not.toContain('Something went wrong');
    expect(container.querySelector('.mapr-picks-track')).toBeTruthy();
    expect(container.querySelectorAll('.mapr-pick-name').length).toBeGreaterThan(0);
    // No manual city picker -- Mapr picks it, not the user.
    expect(container.textContent).not.toContain('Choose a city');
  });

  it('auto-picks a city from location when the streak has none yet, with no picker UI', async () => {
    currentStreaks = [{ ...streak, cityId: null }];
    await openStreak();
    expect(setStreakCityMock).toHaveBeenCalledTimes(1);
    expect(setStreakCityMock.mock.calls[0][0]).toBe(streak.id);
    expect(typeof setStreakCityMock.mock.calls[0][1]).toBe('string');
    expect(container.textContent).not.toContain('Choose a city');
    expect(container.querySelector('.modal-backdrop')).toBeFalsy();
  });

  it('shows a checkmark confirmation, then removes a card from the carousel once rated and guessed', async () => {
    await openStreak();
    const before = container.querySelectorAll('.mapr-pick-name').length;
    const loveButton = container.querySelector('.mapr-pick-vote.love');
    await act(async () => loveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // The vote row is replaced with a checkmark confirmation right away,
    // instead of jumping straight to the guess step.
    expect(container.querySelector('.mapr-pick-vote-done')).toBeTruthy();
    expect(container.textContent).not.toContain('What will your streak partner say?');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 750));
    });
    // Re-render happens via component state (submitCardRating is mocked, no
    // real Firestore round trip) -- the card should now show the guess step.
    expect(container.textContent).toContain('What will your streak partner say?');
    const guessButton = container.querySelector('.mapr-pick-vote.love');
    await act(async () => guessButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.mapr-pick-vote-done')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 750));
    });
    const after = container.querySelectorAll('.mapr-pick-name').length;
    expect(after).toBe(before - 1);
    expect(container.textContent).toContain("Today's results");
  });

  it('lets you tap a card to see the landmark itself', async () => {
    await openStreak();
    const main = container.querySelector('.mapr-pick-main');
    expect(main).toBeTruthy();
    expect(main.tagName).toBe('BUTTON');
    // Should not throw -- just navigates via react-router's history.
    await act(async () => main.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  });
});
