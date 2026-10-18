// @vitest-environment jsdom
// Owner report 2026-10-17: "the streak isn't working with check ins". The
// header only closed the day when it saw a check-in land live; 3 check-ins
// made where that listener wasn't running (another device, the iPhone app, a
// backgrounded tab) left the day open. Now the badge counter's "3 today"
// also asks the server to close it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const yesterday = (() => {
  const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`;
})();
let streakDoc = { id: 'me', mode: 'solo', count: 4, lastCompletedDay: yesterday };
let badges = { actionsToday: 0 };
const closeToday = vi.fn(async () => ({ ok: true, closed: true }));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', requests: [] }) }));
vi.mock('../lib/AdminModeContext', () => ({
  useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }),
}));
vi.mock('../lib/PairStreakContext', () => ({ usePairStreaks: () => ({ streaks: [] }) }));
vi.mock('../lib/BadgesContext', () => ({ useOptionalBadges: () => badges }));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: async () => ({}),
  watchNewCheckins: () => () => {},
  closeSoloToday: (...a) => closeToday(...a),
  subscribeMySoloStreak: (uid, onStreak) => {
    onStreak(streakDoc);
    return () => {};
  },
}));
vi.mock('../lib/leaderboard', () => ({ subscribeLeaderboard: () => () => {} }));
vi.mock('../lib/notifications', () => ({ subscribeMyNotifications: () => () => {} }));

const { default: Header } = await import('./Header');

let root;
let container;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  closeToday.mockClear();
});

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><Header /></MemoryRouter>));
  await act(async () => {});
};

describe('Header closes the streak day from today’s count', () => {
  it('asks the server to close today once 3 check-ins or ratings are in', async () => {
    badges = { actionsToday: 3 };
    await render();
    expect(closeToday).toHaveBeenCalledTimes(1);
  });

  // Owner report 2026-10-18: one check-in left the 🔥 red until a reload.
  it('asks the server to close today after a single real check-in', async () => {
    badges = { actionsToday: 1, checkedInToday: true };
    await render();
    expect(closeToday).toHaveBeenCalledTimes(1);
  });

  it('does nothing under 3, or when today is already closed', async () => {
    badges = { actionsToday: 2 };
    await render();
    expect(closeToday).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    const now = new Date();
    streakDoc = { ...streakDoc, lastCompletedDay: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}` };
    badges = { actionsToday: 5 };
    await render();
    expect(closeToday).not.toHaveBeenCalled();
  });
});
