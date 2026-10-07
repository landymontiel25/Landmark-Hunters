// @vitest-environment jsdom
// The solo-streak listener must be released when the screen closes (it used
// to leak one live Firestore listener per visit), and a failed set-up call
// must not hide a streak that already exists.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const unsub = vi.fn();
const subscribe = vi.fn((uid, onStreak) => {
  onStreak({ id: 'me', mode: 'solo', memberIds: ['me'], memberNames: { me: 'me' }, cityId: 'miami', count: 4, best: 6, freezesLeft: 1, freezeMonth: '2026-9', createdAt: { seconds: 0 } });
  return unsub;
});
let ensure = async () => ({});

vi.mock('../components/MaprPicksCarousel', () => ({ default: () => null }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
vi.mock('../lib/usePickVotes', () => ({ usePickVotes: () => ({ vote: () => Promise.resolve(null) }) }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19 } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/PairStreakContext', () => ({
  usePairStreaks: () => ({ streaks: [], leaveStreak: vi.fn(), startStreakWith: vi.fn(), closeToday: vi.fn() }),
}));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: (...a) => ensure(...a),
  subscribeMySoloStreak: (...a) => subscribe(...a),
  setSoloStreakCity: vi.fn(),
  submitSoloCardRating: vi.fn(),
  subscribeSoloDayEntry: (uid, dayId, onEntry) => {
    onEntry({ uid, ratings: {} });
    return () => {};
  },
  closeSoloToday: vi.fn(),
  spendSoloFreeze: vi.fn(),
  SOLO_FREEZES_PER_MONTH: 1,
}));
vi.mock('../lib/pairStreaks', () => ({
  subscribeDayEntries: (p, d, on) => {
    on({});
    return () => {};
  },
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

let root;
let host;
afterEach(() => {
  host?.remove();
  vi.clearAllMocks();
  ensure = async () => ({});
});

async function mount() {
  const { default: MyStreaks } = await import('./MyStreaks.jsx');
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <MemoryRouter>
        <MyStreaks />
      </MemoryRouter>
    );
  });
}

describe('MyStreaks solo listener', () => {
  it('unsubscribes when the screen unmounts', async () => {
    await mount();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('still shows an existing streak when the set-up call fails', async () => {
    ensure = async () => {
      throw Object.assign(new Error('HTTP 500'), { status: 500 });
    };
    await mount();
    expect(subscribe).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
