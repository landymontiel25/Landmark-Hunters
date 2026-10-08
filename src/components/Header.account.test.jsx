// @vitest-environment jsdom
// Switching accounts must not show the previous account's solo streak while
// the new account's streak doc is still loading.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let currentUser = { uid: 'a' };
// uid -> callback, so the test decides when each account's streak arrives.
const listeners = {};

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: currentUser, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'x', requests: [] }) }));
vi.mock('../lib/AdminModeContext', () => ({
  useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }),
}));
vi.mock('../lib/PairStreakContext', () => ({ usePairStreaks: () => ({ streaks: [] }) }));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: async () => ({}),
  subscribeMySoloStreak: (uid, onStreak) => {
    listeners[uid] = onStreak;
    return () => {};
  },
}));
vi.mock('../lib/leaderboard', () => ({ subscribeLeaderboard: () => () => {} }));
vi.mock('../lib/notifications', () => ({ subscribeMyNotifications: () => () => {} }));

import Header from './Header';

let root;
let container;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
  );

const soloCount = () => container.querySelector('button.header-streak .header-streak-num').textContent;

describe('Header solo streak across accounts', () => {
  it("doesn't carry account A's streak over to account B", async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    currentUser = { uid: 'a' };
    await render();
    const today = new Date();
    await act(async () =>
      listeners.a({ id: 'a', mode: 'solo', count: 9, lastCompletedDay: `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}` })
    );
    expect(soloCount()).toBe('9');

    currentUser = { uid: 'b' };
    await render();
    expect(soloCount()).toBe('0');
  });
});
