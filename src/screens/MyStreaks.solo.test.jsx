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

vi.mock('../components/MaprPicksCarousel', () => ({ default: (p) => <div className="carousel-stub">{p.homeCityId}</div> }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
vi.mock('../lib/usePickVotes', () => ({ usePickVotes: () => ({ vote: () => Promise.resolve(null) }) }));
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
  setSoloStreakCity: vi.fn(async () => {}),
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
const history = vi.hoisted(() => ({ answered: new Map() }));
vi.mock('../lib/soloDeckHistory', () => ({ answeredBefore: async () => history.answered }));

import MyStreaks from './MyStreaks';
import { setSoloStreakCity } from '../lib/soloStreaks';
import { deckPool } from '../lib/sharedDeck';

let container;
afterEach(() => {
  document.body.removeChild(container);
  currentDualStreaks = [];
  fakeEntry = { uid: 'me', ratings: {} };
  entryListener = null;
  submitSoloCardRatingMock.mockClear();
  closeSoloTodayMock.mockClear();
  spendSoloFreezeMock.mockClear();
  setSoloStreakCity.mockClear();
  soloStreak.cityId = 'miami';
  delete soloStreak.cityPinned;
  history.answered = new Map();
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
    // Past the 3: the Travel Picks carousel for the city you are in.
    expect(container.textContent).toContain('Keep going');
    expect(container.querySelector('.carousel-stub')).toBeTruthy();
    expect(closeSoloTodayMock).toHaveBeenCalledTimes(1);
  });

  it('opens the dual streak picker from the solo detail\'s invite button, without touching the solo count', async () => {
    await render();

    const inviteBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Start a Dual Streak'));
    await act(async () => inviteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('Start a Streak');
    expect(container.textContent).toContain("Pick a friend");
  });

  it('moves the cards to the city you are in (Miami, not Villanova) before any is rated', async () => {
    soloStreak.cityId = 'villanova';
    await render();
    expect(setSoloStreakCity).toHaveBeenCalledWith('me', 'miami');
  });

  it('keeps the city once a card is rated today', async () => {
    soloStreak.cityId = 'villanova';
    fakeEntry = { uid: 'me', ratings: { [deckPool('villanova')[0]]: 'yes' } };
    await render();
    expect(setSoloStreakCity).not.toHaveBeenCalled();
  });

  // Owner, 2026-10-21: everything in Villanova was rated, so the cards kept
  // repeating. A city dropdown lets you choose where today's 3 come from.
  it('the city dropdown lists cities with how many new places each has, and choosing one pins it', async () => {
    const pool = deckPool('miami');
    history.answered = new Map(pool.slice(0, 2).map((id) => [id, 1]));
    await render();
    const select = container.querySelector('#solo-city');
    expect(select.value).toBe('auto');
    const miami = [...select.options].find((o) => o.value === 'miami');
    expect(miami.textContent).toBe(`Miami (${pool.length - 2} new)`);
    expect([...select.options][0].textContent).toContain('Where I am (Miami)');
    await act(async () => {
      select.value = 'philly';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setSoloStreakCity).toHaveBeenCalledWith('me', 'philly', { pinned: true });
  });

  it('a city you chose stays put: GPS does not move it back', async () => {
    soloStreak.cityId = 'villanova';
    soloStreak.cityPinned = true;
    await render();
    expect(setSoloStreakCity).not.toHaveBeenCalled();
    expect(container.querySelector('#solo-city').value).toBe('villanova');
  });

  it('"Where I am" unpins and goes back to the city you are in', async () => {
    soloStreak.cityId = 'villanova';
    soloStreak.cityPinned = true;
    await render();
    const select = container.querySelector('#solo-city');
    await act(async () => {
      select.value = 'auto';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setSoloStreakCity).toHaveBeenCalledWith('me', 'miami', { pinned: false });
  });

  it('the city is locked once a card is rated today', async () => {
    fakeEntry = { uid: 'me', ratings: { [deckPool('miami')[0]]: 'yes' } };
    await render();
    expect(container.querySelector('#solo-city').disabled).toBe(true);
    expect(container.textContent).toContain("You can change the city before you rate today's first card.");
  });

  it('skips places you answered on earlier days', async () => {
    const pool = deckPool('miami');
    history.answered = new Map(pool.slice(0, pool.length - 3).map((id) => [id, 1]));
    await render();
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    const { getRegion } = await import('../data/regions');
    const fresh = pool.slice(-3).map((id) => getRegion('miami').landmarks.find((l) => l.id === id).name);
    expect(names.sort()).toEqual(fresh.sort());
  });
});
