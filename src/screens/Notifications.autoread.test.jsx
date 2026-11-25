// @vitest-environment jsdom
// Opening the list reads it (owner, 2026-11-25): nobody taps each notice.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ rows: [], markMany: vi.fn(async () => {}) }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, loading: false, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: {}, profileFresh: false, requests: [], reload: async () => {} }) }));
vi.mock('../lib/soloStreaks', () => ({ subscribeMySoloStreak: () => () => {} }));
vi.mock('../lib/notifications', () => ({
  subscribeMyNotifications: (_uid, cb) => {
    cb(h.rows);
    return () => {};
  },
  markNotificationRead: async () => {},
  markNotificationsRead: (...a) => h.markMany(...a),
}));

let container;
afterEach(() => container?.remove());
async function renderIt() {
  const { default: Notifications } = await import('./Notifications.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<MemoryRouter><Notifications /></MemoryRouter>));
}
const now = Math.floor(Date.now() / 1000);

describe('the notification list', () => {
  it('marks everything unread read the moment it opens, once, and keeps them marked New for this visit', async () => {
    h.rows = [
      { id: 'n1', type: 'offline_checkin_paid', message: "Your offline check-in at Nippers synced and it's verified. +100 points.", read: false, createdAt: { seconds: now - 120 } },
      { id: 'n2', type: 'admin_test', message: '\u{1F514} Push notifications are working on this device.', read: true, createdAt: { seconds: now - 7200 } },
      { id: 'n3', type: 'onboarding_update', message: 'Onboarding has been updated.', read: false, createdAt: { seconds: now - 60 } },
    ];
    h.markMany.mockClear();
    await renderIt();
    // One batch, only the unread ones (the onboarding notice keeps its own rule).
    expect(h.markMany).toHaveBeenCalledOnce();
    expect(h.markMany).toHaveBeenCalledWith(['n1']);
    const rows = [...container.querySelectorAll('.notif-row')];
    const row = (t) => rows.find((r) => r.textContent.includes(t));
    // New: green dot and "New"; read: neither.
    expect(row('Nippers').classList.contains('is-new')).toBe(true);
    expect(row('Nippers').querySelector('.notif-dot')).toBeTruthy();
    expect(row('Nippers').querySelector('.notif-new').textContent).toBe('New');
    expect(row('Push notifications').classList.contains('is-new')).toBe(false);
    expect(row('Push notifications').querySelector('.notif-dot')).toBeNull();
    // The message's own emoji becomes the icon; kinds without one get theirs.
    expect(row('Push notifications').querySelector('.notif-icon').textContent).toBe('\u{1F514}');
    expect(row('Push notifications').querySelector('.notif-message').textContent).toBe('Push notifications are working on this device.');
    expect(row('Nippers').querySelector('.notif-icon').textContent).toBe('\u{1F4CD}');
    expect(row('Nippers').querySelector('.notif-meta').textContent).toMatch(/New2m/);
    // Design language: a section label, a list of rows, real buttons, no em dashes.
    expect(container.querySelector('.notif-section-label').textContent).toBe('Updates');
    expect(container.querySelectorAll('.notif-row-main').length).toBe(3);
    expect(container.textContent).not.toMatch(/—/);
  });

  it('an empty list says so plainly', async () => {
    h.rows = [];
    await renderIt();
    expect(container.querySelector('.notif-empty').textContent).toBe("You're all caught up. Nothing new right now.");
  });
});
