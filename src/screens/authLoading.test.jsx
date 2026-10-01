// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

// Auth is still restoring the saved session (loading: true, user: null) --
// a signed-in person must not see "sign in" wording or get redirected away.
async function renderWhileAuthLoading(path, importScreen) {
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({ user: null, loading: true, firebaseEnabled: true }),
  }));
  vi.doMock('../lib/FriendsContext', () => ({
    useFriends: () => ({ myProfile: null, profileFresh: false, requests: [], reload: async () => {} }),
  }));
  vi.doMock('../lib/BadgesContext', () => ({ useBadges: () => ({ stats: null, badges: [], badgeEarnedAt: {} }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] }, toggleSavedInterest: () => {} }) }));
  vi.doMock('../lib/useCheckIn', () => ({ useCheckIn: () => ({ claimedMap: {} }) }));
  vi.doMock('../components/CheckinsGallery', () => ({ default: () => null }));
  vi.doMock('../lib/notifications', () => ({ subscribeMyNotifications: vi.fn(() => () => {}), markNotificationRead: vi.fn() }));
  vi.doMock('../lib/soloStreaks', () => ({ subscribeMySoloStreak: vi.fn(() => () => {}) }));
  const { default: Screen } = await importScreen();
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={<Screen />} />
          <Route path="/profile" element={<p>PROFILE PAGE</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  return container;
}

vi.setConfig({ testTimeout: 30000 });

describe('screens while the saved session is still loading', () => {
  it('Onboarding does not bounce to Profile', async () => {
    const el = await renderWhileAuthLoading('/onboarding', () => import('./Onboarding.jsx'));
    expect(el.textContent).not.toContain('PROFILE PAGE');
  });

  it('My Cities does not tell a signed-in user to sign in', async () => {
    const el = await renderWhileAuthLoading('/cities', () => import('./MyCities.jsx'));
    expect(el.textContent).not.toContain('Sign in');
  });

  it('Full Stats does not tell a signed-in user to sign in', async () => {
    const el = await renderWhileAuthLoading('/stats', () => import('./FullStats.jsx'));
    expect(el.textContent).not.toContain('Sign in');
  });

  it('Notifications does not claim "all caught up" before anything loaded', async () => {
    const el = await renderWhileAuthLoading('/notifications', () => import('./Notifications.jsx'));
    expect(el.textContent).not.toContain('all caught up');
  });
});
