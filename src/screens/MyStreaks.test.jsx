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
// listener fires with the new state) -- needed for the rate -> guess flow
// to actually exercise real state, not just call mocked functions that go
// nowhere. rateDelayMs/rateShouldFail let individual tests simulate a slow
// or failing write, to prove the checkmark doesn't depend on round-trip
// timing (see the "keeps the checkmark up during a slow write" test).
let fakeEntries = {};
let entriesListener = null;
let rateDelayMs = 0;
let rateShouldFail = false;
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

  it('rates each card in place (checkmark, no disappearing), then unlocks guessing once all 3 are rated', async () => {
    await openStreak();
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);

    // Rating phase: voting on a card swaps its row for a checkmark right
    // there -- the card itself stays put, nothing is removed from the deck.
    // Check after 2 of 3: still mid-phase, so the checkmarks are visible
    // (once the 3rd lands, the whole deck flips straight to the guess
    // phase, whose fresh cards have no checkmark of their own yet).
    for (let i = 0; i < 2; i++) {
      const cards = container.querySelectorAll('.mapr-pick');
      const voteBtn = cards[i].querySelector('.mapr-pick-vote.love');
      await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    expect(container.querySelectorAll('.mapr-pick-name').length).toBe(3);
    expect(container.querySelectorAll('.mapr-pick-vote-done').length).toBe(2);

    const lastCard = container.querySelectorAll('.mapr-pick')[2];
    await act(async () =>
      lastCard.querySelector('.mapr-pick-vote.love').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );

    // All 3 rated -- the same 3 cards now collect a guess instead.
    expect(container.textContent).toContain("You've rated your 3 for today");
    expect(container.textContent).toContain('What will @buddy say about this one?');
    expect(container.querySelectorAll('.mapr-pick-vote').length).toBe(9); // 3 cards x 3 fresh vote buttons

    for (let i = 0; i < 3; i++) {
      const cards = container.querySelectorAll('.mapr-pick');
      const voteBtn = cards[i].querySelector('.mapr-pick-vote.love');
      await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    expect(container.textContent).toContain("Today's results");
  });

  it('keeps the checkmark up during a slow write instead of silently reverting to the vote row', async () => {
    rateDelayMs = 500;
    await openStreak();
    const voteBtn = container.querySelector('.mapr-pick-vote.love');
    await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Checkmark shows immediately -- optimistic, doesn't wait on the write.
    expect(container.querySelector('.mapr-pick-vote-done')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    // Still showing the checkmark 300ms in, well before the 500ms write
    // resolves -- this used to silently reset back to the vote row.
    expect(container.querySelector('.mapr-pick-vote-done')).toBeTruthy();
    expect(container.querySelectorAll('.mapr-pick-vote.love').length).toBe(2);
  });

  it('shows an error and reverts the card if the write actually fails', async () => {
    rateShouldFail = true;
    await openStreak();
    const voteBtn = container.querySelector('.mapr-pick-vote.love');
    await act(async () => voteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.mapr-pick-vote-done')).toBeFalsy();
    expect(container.textContent).toMatch(/couldn't save/i);
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
