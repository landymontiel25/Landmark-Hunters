// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ markRead: vi.fn(async () => {}), show: vi.fn(), rows: [], profile: {} }));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, loading: false, firebaseEnabled: true }) }));
vi.mock('../lib/FriendsContext', () => ({
  useFriends: () => ({ myProfile: h.profile, profileFresh: true, requests: [], reload: async () => {} }),
}));
vi.mock('../lib/ToastContext', async (orig) => ({
  ...(await orig()),
  useToast: () => ({ show: h.show, dismiss: () => {} }),
}));
vi.mock('../lib/notifications', () => ({
  subscribeMyNotifications: (_uid, cb) => {
    cb(h.rows);
    return () => {};
  },
  markNotificationRead: (...a) => h.markRead(...a),
}));
vi.mock('../lib/soloStreaks', () => ({ subscribeMySoloStreak: vi.fn(() => () => {}) }));

let container;
const notice = (id, extra = {}) => ({ id, type: 'onboarding_update', message: 'Onboarding has been updated. Finish it to get better picks from Mapr.', read: false, ...extra });

async function renderIt() {
  const { default: Notifications } = await import('./Notifications.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/onboarding" element={<p>ONBOARDING FLOW</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
}

beforeEach(() => {
  h.markRead.mockClear();
  h.show.mockClear();
});
afterEach(() => container?.remove());

describe('onboarding notice', () => {
  it('is cleared, not opened, when onboarding is already finished', async () => {
    h.profile = { onboardingVersion: 1 };
    h.rows = [notice('n1'), notice('n2')];
    await renderIt();
    // Both stale notices are marked read on their own (clears the red badge).
    expect(h.markRead).toHaveBeenCalledWith('n1');
    expect(h.markRead).toHaveBeenCalledWith('n2');
    h.markRead.mockClear();
    const row = [...container.querySelectorAll('[role="button"]')].find((b) => b.textContent.includes('Onboarding has been updated'));
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).not.toContain('ONBOARDING FLOW');
    expect(h.show).toHaveBeenCalledWith('Onboarding is already finished.', expect.anything());
  });

  it('still opens the flow when onboarding is not finished', async () => {
    h.profile = { onboardingVersion: 0, onboardingSource: 'signup-skipped' };
    h.rows = [notice('n1')];
    await renderIt();
    expect(h.markRead).not.toHaveBeenCalled();
    const row = [...container.querySelectorAll('[role="button"]')].find((b) => b.textContent.includes('Onboarding has been updated'));
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('ONBOARDING FLOW');
  });
});
