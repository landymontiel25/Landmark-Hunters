// @vitest-environment jsdom
// The header's streak badge must release its Firestore listener on unmount
// (it used to return the unsubscribe from inside a .then(), i.e. to nobody),
// and a failed streak set-up call must not hide an existing streak.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const unsub = vi.fn();
const subscribe = vi.fn(() => unsub);
let ensure = async () => ({});

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', requests: [] }) }));
vi.mock('../lib/AdminModeContext', () => ({
  useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }),
}));
vi.mock('../lib/PairStreakContext', () => ({ usePairStreaks: () => ({ streaks: [] }) }));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: (...a) => ensure(...a),
  watchNewCheckins: (...a) => (globalThis.__watchNew || (() => () => {}))(...a),
  closeSoloToday: (...a) => (globalThis.__closeToday || (async () => ({})))(...a),
  subscribeMySoloStreak: (...a) => subscribe(...a),
}));
vi.mock('../lib/leaderboard', () => ({ subscribeLeaderboard: () => () => {} }));
vi.mock('../lib/notifications', () => ({ subscribeMyNotifications: () => () => {} }));

import Header from './Header';

let root;
let container;
afterEach(() => {
  container?.remove();
  vi.clearAllMocks();
  ensure = async () => ({});
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
  });
}

describe('Header streak badge listener', () => {
  it('unsubscribes when the header unmounts', async () => {
    await mount();
    expect(subscribe).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('still listens for an existing streak when the set-up call fails', async () => {
    ensure = async () => {
      throw new Error('offline');
    };
    await mount();
    expect(subscribe).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('closes the streak day when a new check-in or rating lands, until today is secured', async () => {
    let onNew;
    const stopWatching = vi.fn();
    globalThis.__watchNew = (uid, cb) => {
      onNew = cb;
      return stopWatching;
    };
    const close = vi.fn(async () => ({ ok: true }));
    globalThis.__closeToday = close;
    let pushStreak;
    subscribe.mockImplementation((uid, cb) => {
      pushStreak = cb;
      return unsub;
    });
    await mount();
    await act(async () => onNew(1));
    expect(close).toHaveBeenCalledTimes(1);
    const d = new Date();
    const today = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    await act(async () => pushStreak({ id: 'me', count: 4, lastCompletedDay: today }));
    await act(async () => onNew(1));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(stopWatching).toHaveBeenCalledTimes(1);
    delete globalThis.__watchNew;
    delete globalThis.__closeToday;
  });
});
