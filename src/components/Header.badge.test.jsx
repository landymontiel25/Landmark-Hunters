// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function renderHeader({ notifications = [], requests = [] } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', requests }) }));
  vi.doMock('../lib/AdminModeContext', () => ({
    useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }),
  }));
  vi.doMock('../lib/PairStreakContext', () => ({ usePairStreaks: () => ({ streaks: [] }) }));
  vi.doMock('../lib/soloStreaks', () => ({
    ensureSoloStreak: vi.fn(async () => ({})),
    subscribeMySoloStreak: () => () => {},
  }));
  vi.doMock('../lib/leaderboard', () => ({ subscribeLeaderboard: () => () => {} }));
  vi.doMock('../lib/notifications', () => ({
    subscribeMyNotifications: (uid, onData) => {
      onData(notifications);
      return () => {};
    },
  }));
  const { default: Header } = await import('./Header.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
  );
  return container;
}

const badgeOnPill = (el) => el.querySelector('.profile-menu > .notif-badge');

describe('Header notification badge on the username pill', () => {
  it('shows the unread count without opening the menu', async () => {
    const el = await renderHeader({ notifications: [{ id: 'a', read: false }, { id: 'b', read: false }, { id: 'c', read: true }] });
    expect(badgeOnPill(el).textContent).toBe('2');
  });

  it('counts pending friend requests too', async () => {
    const el = await renderHeader({ notifications: [{ id: 'a', read: false }], requests: [{ id: 'r1' }] });
    expect(badgeOnPill(el).textContent).toBe('2');
  });

  it('caps at 9+', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), read: false }));
    const el = await renderHeader({ notifications: many });
    expect(badgeOnPill(el).textContent).toBe('9+');
  });

  it('is hidden when there is nothing new', async () => {
    const el = await renderHeader({ notifications: [{ id: 'a', read: true }] });
    expect(badgeOnPill(el)).toBeNull();
  });

  it('shows the same badge on the Notifications button inside the open menu', async () => {
    const el = await renderHeader({ notifications: [{ id: 'a', read: false }] });
    await act(async () => el.querySelector('.profile-menu-trigger').click());
    expect(el.querySelectorAll('.notif-badge')).toHaveLength(2);
  });
});
