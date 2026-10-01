// @vitest-environment jsdom
// Regression test for a real, repeatedly-reported bug: the streak
// countdown popover rendered transparent over the Map tab's Leaflet view
// no matter how forcefully its background was pinned in CSS -- a
// compositing/paint issue tied to it being a CSS-positioned descendant of
// the header, nested in the same DOM branch as the map. The fix moves it
// to a React portal straight onto document.body. This test proves the
// popover's DOM node actually lands there (not nested under the header),
// and that the click-outside/click-inside behavior still works correctly
// now that it's no longer a DOM descendant of its trigger button.
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const soloStreak = {
  id: 'me',
  mode: 'solo',
  count: 6,
  lastCompletedDay: (() => {
    const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`;
  })(),
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
afterEach(() => {
  document.body.removeChild(container);
});

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
  );
};

describe('Header streak popover portal', () => {
  it('renders the popover outside the header, straight on document.body', async () => {
    await render();
    const flame = [...container.querySelectorAll('button.header-streak')][0];
    await act(async () => flame.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Not inside the app's own container -- it's a sibling of it, on body.
    expect(container.querySelector('.streak-popover')).toBeFalsy();
    const popover = document.body.querySelector('.streak-popover');
    expect(popover).toBeTruthy();
    expect(popover.textContent).toContain('streak ends in');
    expect(container.contains(popover)).toBe(false);
  });

  it('stays open when clicking inside the portaled popover', async () => {
    await render();
    const flame = container.querySelector('button.header-streak');
    await act(async () => flame.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const popover = document.body.querySelector('.streak-popover');
    await act(async () => popover.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.body.querySelector('.streak-popover')).toBeTruthy();
  });

  it('closes when clicking outside both the trigger and the popover', async () => {
    await render();
    const flame = container.querySelector('button.header-streak');
    await act(async () => flame.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.body.querySelector('.streak-popover')).toBeTruthy();

    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.body.querySelector('.streak-popover')).toBeFalsy();
  });
});
