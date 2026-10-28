// @vitest-environment jsdom
// Owner ask 2026-10-28: tapping "tagged you in their rating" opens that rating.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  rows: [
    { id: 't1', type: 'rating_tag', message: '@orlando tagged you in their rating of El Arepazo Doral.', read: false, landmarkId: 'el-arepazo-doral', regionId: 'miami', fromUid: 'u2' },
  ],
}));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, loading: false, firebaseEnabled: true }) }));
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
vi.mock('../lib/soloStreaks', () => ({ subscribeMySoloStreak: (_uid, cb) => (cb(null), () => {}) }));

let container;
afterEach(() => container?.remove());

let seen;
function Landing() {
  const l = useLocation();
  seen = { path: l.pathname, state: l.state };
  return <p>landing</p>;
}

describe('rating tag notification', () => {
  it('opens the place with the tagger\'s rating to focus', async () => {
    const { default: Notifications } = await import('./Notifications.jsx');
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/notifications']}>
          <Routes>
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/landmarks/:region/:id" element={<Landing />} />
          </Routes>
        </MemoryRouter>
      );
    });
    expect(container.textContent).toContain('View rating');
    const row = [...container.querySelectorAll('[role="button"]')].find((r) => r.textContent.includes('tagged you'));
    await act(async () => row.click());
    expect(seen.path).toBe('/landmarks/miami/el-arepazo-doral');
    expect(seen.state).toEqual({ focusReviewId: 'u2_el-arepazo-doral' });
  });
});
