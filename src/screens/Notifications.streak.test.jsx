// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { dayKey } from '../lib/streaks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  streak: null,
  user: { uid: 'u1' },
  rows: [{ id: 'w1', type: 'streak_warning', message: 'Your streak ends at midnight', read: false, createdAt: { seconds: Math.floor(Date.now() / 1000) } }],
}));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: h.user, loading: false, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({
  useFriends: () => ({ myProfile: {}, profileFresh: true, requests: [], reload: async () => {} }),
}));
vi.mock('../lib/notifications', () => ({
  subscribeMyNotifications: (_uid, cb) => {
    cb(h.rows);
    return () => {};
  },
  markNotificationRead: async () => {},
}));
vi.mock('../lib/soloStreaks', () => ({
  subscribeMySoloStreak: (_uid, cb) => {
    cb(h.streak);
    return () => {};
  },
}));

let container;
afterEach(() => container?.remove());

async function renderIt() {
  const { default: Notifications } = await import('./Notifications.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    );
  });
}

describe('streak warning countdown', () => {
  it('shows Kept when a freeze covers today, same as the header badge', async () => {
    h.streak = { count: 5, lastCompletedDay: '2000-1-1', frozenDays: [dayKey(new Date())] };
    await renderIt();
    expect(container.querySelector('.streak-countdown').textContent).toContain('Kept');
  });
});
