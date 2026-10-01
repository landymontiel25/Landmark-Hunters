// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const soloStreak = {
  id: 'me',
  mode: 'solo',
  count: 6,
  lastCompletedDay: '2026-9-1',
  createdAt: { seconds: 0 },
};

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', requests: [] }) }));
vi.mock('../lib/AdminModeContext', () => ({
  useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }),
}));
vi.mock('../lib/PairStreakContext', () => ({ usePairStreaks: () => ({ streaks: [] }) }));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: vi.fn(async () => ({})),
  subscribeMySoloStreak: (uid, onStreak) => {
    onStreak(soloStreak);
    return () => {};
  },
}));
vi.mock('../lib/leaderboard', () => ({ subscribeLeaderboard: () => () => {} }));
vi.mock('../lib/notifications', () => ({ subscribeMyNotifications: () => () => {} }));

import Header from './Header';

let container;
beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 1, 23, 59, 30), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }));
afterEach(() => {
  document.body.removeChild(container);
  vi.useRealTimers();
});

describe('solo streak badge across midnight', () => {
  it('stops saying today is secured once the day rolls over', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      )
    );
    const btn = () => container.querySelector('.header-streak');
    expect(btn().getAttribute('aria-label')).toContain('secured');
    expect(btn().getAttribute('aria-label')).not.toContain('not secured');
    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(btn().getAttribute('aria-label')).toContain('not secured yet');
  });
});
