// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

let friends = new Set(['ann']);
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ friendUids: friends }) }));
const ts = (d) => ({ seconds: Date.UTC(2026, 10, d, 15) / 1000 });
vi.mock('../lib/leaderboard', () => ({
  getUserStats: vi.fn(async () => ({ totalPoints: 4281, checkins: 5, cities: 2 })),
  getUserCheckins: vi.fn(async () => [
    { id: 'r', landmarkName: 'Rated only', ratingOnly: true, createdAt: ts(6) },
    { id: 'a', landmarkName: 'Vizcaya Museum and Gardens', visited: true, createdAt: ts(5) },
    { id: 'b', landmarkName: 'Freedom Tower', visited: true, createdAt: ts(4) },
    { id: 'c', landmarkName: 'Wynwood Walls', visited: true, createdAt: ts(3) },
    { id: 'd', landmarkName: 'Fourth one', visited: true, createdAt: ts(2) },
  ]),
  isRealCheckin: (c) => c.visited === true && c.ratingOnly !== true,
}));

import FriendStatsModal from './FriendStatsModal';

let container;
let root;
let onClose;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  friends = new Set(['ann']);
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function Where() {
  return <p className="where">{useLocation().pathname}</p>;
}
const mount = async (uid = 'ann') => {
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<FriendStatsModal uid={uid} name={uid} onClose={onClose} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
  );
};
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const where = () => container.querySelector('.where')?.textContent;

describe('FriendStatsModal (the friend popup)', () => {
  it('shows @username and points on one line, then the three latest real check-ins with dates', async () => {
    await mount();
    const top = container.querySelector('.fpop-top');
    expect(top.querySelector('.fpop-name').textContent).toBe('@ann');
    expect(top.querySelector('.fpop-points').textContent).toBe('4,281 pts');
    expect(container.querySelector('.fpop-label').textContent).toBe('Check-ins');
    const rows = [...container.querySelectorAll('.fpop-row')];
    expect(rows.map((r) => r.querySelector('.fpop-row-name').textContent)).toEqual(['Vizcaya Museum and Gardens', 'Freedom Tower', 'Wynwood Walls']);
    expect(rows[0].querySelector('.fpop-row-date').textContent).toMatch(/2026/);
    // Plain rows: no stat cards.
    expect(container.querySelector('.profile-stat')).toBeNull();
  });

  it('See all opens the check-ins list', async () => {
    await mount();
    await act(async () => button('See all').click());
    expect(where()).toBe('/friend/ann/checkins');
  });

  it('the cities arrow still opens the cities list', async () => {
    await mount();
    await act(async () => button('cities').click());
    expect(where()).toBe('/friend/ann/cities');
  });

  it('See full profile sits above Close and opens the profile', async () => {
    await mount();
    const actions = [...container.querySelectorAll('.fpop-actions button')].map((b) => b.textContent);
    expect(actions).toEqual(['See full profile', 'Close']);
    await act(async () => button('See full profile').click());
    expect(where()).toBe('/friend/ann');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no full profile for someone who is not a friend', async () => {
    friends = new Set();
    await mount('stranger');
    expect(button('See full profile')).toBeUndefined();
    expect(button('Close')).toBeTruthy();
  });
});
