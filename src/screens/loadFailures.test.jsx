// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
});

async function render(path, importScreen, { stats, profileFresh = true }) {
  const reload = vi.fn();
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({ user: { uid: 'u1', emailVerified: true }, loading: false, firebaseEnabled: true }),
  }));
  vi.doMock('../lib/FriendsContext', () => ({
    useFriends: () => ({ myProfile: null, profileFresh, requests: [], reload }),
  }));
  vi.doMock('../lib/BadgesContext', () => ({
    useBadges: () => ({ stats, badges: [], badgeEarnedAt: {}, reload }),
  }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] }, toggleSavedInterest: () => {} }) }));
  vi.doMock('../lib/useCheckIn', () => ({ useCheckIn: () => ({ claimedMap: {} }) }));
  vi.doMock('../components/CheckinsGallery', () => ({ default: () => null }));
  const { default: Screen } = await importScreen();
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={<Screen />} />
        </Routes>
      </MemoryRouter>
    );
  });
  return { el: container, reload };
}

vi.setConfig({ testTimeout: 30000 });

const FAILED = { totalPoints: 0, checkins: 0, cities: 0, cityIds: [], cityLastVisit: {}, cityPoints: {}, failed: true };

describe('screens when their data could not be read', () => {
  it('My Cities says it could not load, with a retry, instead of going blank', async () => {
    const { el, reload } = await render('/cities', () => import('./MyCities.jsx'), { stats: FAILED });
    expect(el.textContent).toContain("couldn't load your cities");
    const retry = [...el.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent));
    await act(async () => retry.click());
    expect(reload).toHaveBeenCalled();
  });

  it('My Cities shows an empty state for a traveler with no check-ins yet', async () => {
    const stats = { ...FAILED, failed: undefined };
    const { el } = await render('/cities', () => import('./MyCities.jsx'), { stats });
    expect(el.textContent).toContain('No cities yet');
  });

  it('Full Stats does not present failed zeros as "Level 1"', async () => {
    const { el } = await render('/stats', () => import('./FullStats.jsx'), { stats: FAILED });
    expect(el.textContent).toContain("couldn't load your level");
    expect(el.textContent).not.toContain('Level 1');
  });

  it('Onboarding stops showing a skeleton forever when the profile never loads', async () => {
    vi.useFakeTimers();
    const { el, reload } = await render('/onboarding', () => import('./Onboarding.jsx'), { stats: null, profileFresh: false });
    expect(el.textContent).not.toContain("couldn't load your profile");
    await act(async () => {
      vi.advanceTimersByTime(11000);
    });
    expect(el.textContent).toContain("couldn't load your profile");
    const retry = [...el.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent));
    await act(async () => retry.click());
    expect(reload).toHaveBeenCalled();
  });
});
