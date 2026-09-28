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
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/PairStreakContext', () => ({
  usePairStreaks: () => ({ streaks: currentStreaks, leaveStreak: vi.fn(), startStreakWith: vi.fn(), closeToday: vi.fn() }),
}));
// The solo streak stays null in these dual-streak-focused tests (as if
// ensureSoloStreak resolved but no doc has synced back yet) -- exercised
// separately in its own test.
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: vi.fn(async () => ({})),
  subscribeMySoloStreak: (uid, onStreak) => {
    onStreak(null);
    return () => {};
  },
  setSoloStreakCity: vi.fn(),
  submitSoloCardRating: vi.fn(),
  subscribeSoloDayEntry: (uid, dayId, onEntry) => {
    onEntry({ uid, ratings: {} });
    return () => {};
  },
  closeSoloToday: vi.fn(async () => ({ ok: true })),
  spendSoloFreeze: vi.fn(),
  SOLO_FREEZES_PER_MONTH: 1,
}));
const setStreakCityMock = vi.fn(async () => {});
// A minimal fake of Firestore's real behavior (write, then the snapshot
// listener fires with the new state) -- needed for the rate -> guess flow
// to actually exercise real state, not just call mocked functions that go
// nowhere. rateDelayMs/rateShouldFail let individual tests simulate a slow
// or failing write, to prove a card's removal doesn't depend on round-trip
// timing (see the "stays gone through a slow write" test) and reverts
// cleanly on a real failure.
let fakeEntries = {};
let entriesListener = null;
let rateDelayMs = 0;
let rateShouldFail = false;
let entriesShouldError = false;
const notifyEntries = () => entriesListener?.({ ...fakeEntries });
vi.mock('../lib/pairStreaks', () => ({
  subscribeDayEntries: (pairId, dayId, onEntries, onError) => {
    if (entriesShouldError) {
      onError(new Error('listener failed'));
      return () => {};
    }
    entriesListener = onEntries;
    onEntries({ ...fakeEntries });
    return () => {
      entriesListener = null;
    };
  },
  setStreakCity: (...args) => setStreakCityMock(...args),
  submitCardRating: async (pairId, uid, landmarkId, verdict) => {
    if (rateDelayMs) await new Promise((r) => setTimeout(r, rateDelayMs));
    if (rateShouldFail) throw new Error('write failed');
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
  rateDelayMs = 0;
  rateShouldFail = false;
  entriesShouldError = false;
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
  // MyStreaks opens on the Solo tab; switch to Dual, then tap into the one
  // streak to reach the detail view (the code path that used getRegion).
  const dualTab = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Dual'));
  await act(async () => dualTab.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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

  it('a card disappears the instant it is voted on, exactly like a Mapr Travel Picks vote', async () => {
    await openStreak();
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);

    const firstVote = container.querySelector('.mapr-pick-vote.love');
    await act(async () => firstVote.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Gone immediately -- no checkmark stage, no lingering card.
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(2);

    const secondVote = container.querySelector('.mapr-pick-vote.love');
    await act(async () => secondVote.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(1);
  });

  it('shows a big animated banner when all 3 are rated and guessing unlocks', async () => {
    await openStreak();
    for (let i = 0; i < 3; i++) {
      const voteBtn = container.querySelector('.mapr-pick-vote.love');
      await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    // All 3 rated -- the same 3 cards now collect a guess instead, behind
    // a big, clearly-a-new-step banner (not the same small text as before).
    expect(container.querySelector('.streak-guess-banner')).toBeTruthy();
    expect(container.textContent).toContain('Your turn to guess!');
    expect(container.textContent).toContain('What will @buddy say about this one?');
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);
    expect(container.querySelectorAll('.mapr-pick-vote').length).toBe(9); // 3 cards x 3 fresh vote buttons

    for (let i = 0; i < 3; i++) {
      const voteBtn = container.querySelector('.mapr-pick-vote.love');
      await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    expect(container.textContent).toContain("Today's results");
  });

  it('a card stays gone through a slow write, instead of reappearing before it resolves', async () => {
    rateDelayMs = 500;
    await openStreak();
    const voteBtn = container.querySelector('.mapr-pick-vote.love');
    await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Gone immediately -- optimistic, doesn't wait on the write.
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    // Still gone 300ms in, well before the 500ms write resolves.
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(2);
  });

  it('brings the card back and shows an error banner if the write actually fails', async () => {
    rateShouldFail = true;
    await openStreak();
    const voteBtn = container.querySelector('.mapr-pick-vote.love');
    await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // The optimistic removal gets undone -- the card is back, not lost.
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);
    expect(container.textContent).toMatch(/couldn't save/i);
  });

  it('surfaces an error banner if the entries listener itself fails, instead of silently showing nothing', async () => {
    entriesShouldError = true;
    await openStreak();
    expect(container.textContent).toMatch(/couldn't load today's ratings/i);
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
