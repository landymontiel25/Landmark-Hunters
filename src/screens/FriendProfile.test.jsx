// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const ts = (y, m, d) => ({ seconds: Date.UTC(y, m - 1, d, 15) / 1000 });
let profile;
let blocked;
let streak;
let board;
let checkins;
let stats;
const api = { removeFriend: vi.fn(async () => ({ ok: true })), getFriendSoloStreak: vi.fn(async () => streak) };
const blockUser = vi.fn(async () => {});
const reload = vi.fn(async () => {});

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ friendUids: new Set(['ann']), friendsKnown: true, reload }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/friends', () => ({ getUserProfile: vi.fn(async () => profile) }));
vi.mock('../lib/blocks', () => ({ listBlockedUsers: vi.fn(async () => blocked), blockUser: (...a) => blockUser(...a) }));
vi.mock('../lib/friendProfileApi', () => ({ getFriendSoloStreak: (...a) => api.getFriendSoloStreak(...a), removeFriend: (...a) => api.removeFriend(...a) }));
vi.mock('../lib/leaderboard', () => ({
  getUserStats: vi.fn(async () => stats),
  getUserCheckins: vi.fn(async () => checkins),
  getFriendsLeaderboard: vi.fn(async () => board),
  rankOf: (entries, idx) => entries.findIndex((x) => x.points === entries[idx].points) + 1,
  isRealCheckin: (c) => c.visited === true && c.ratingOnly !== true,
}));

import FriendProfile from './FriendProfile';

let container;
let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  profile = { uid: 'ann', username: 'ann', displayName: 'Ann Lee', public: true, createdAt: ts(2026, 3, 14), homeAddress: '1 Secret St', email: 'ann@example.com' };
  blocked = [];
  const today = new Date();
  // The streaks' own day key (streaks.js dayKey): month 0-based, no padding.
  const key = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  streak = { soloStreak: { count: 6, lastCompletedDay: key, frozenDays: [] } };
  board = [
    { userId: 'bob', points: 900 },
    { userId: 'ann', points: 450 },
    { userId: 'me', points: 120 },
  ];
  checkins = [{ id: 'x', landmarkName: 'Freedom Tower', region: 'miami', visited: true, createdAt: ts(2026, 11, 2) }];
  stats = { totalPoints: 2500, checkins: 12, cities: 3, cityIds: ['miami', 'philly', 'madrid'] };
  api.removeFriend.mockClear();
  blockUser.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  document.body.innerHTML = '';
});

function Where() {
  return <p className="where">{useLocation().pathname}</p>;
}
const mount = async () => {
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/friend/ann']}>
        <Routes>
          <Route path="/friend/:uid" element={<FriendProfile />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
  );
};
const text = () => container.textContent;
const rowValue = (label) => [...container.querySelectorAll('.fp-row')].find((r) => r.querySelector('.fp-row-label').textContent.startsWith(label))?.querySelector('.fp-row-value').textContent;
const button = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);

describe('FriendProfile', () => {
  it('shows the header, points with rank, counts, the solo streak and the last check-in as text', async () => {
    await mount();
    expect(container.querySelector('h1').textContent).toBe('Ann Lee');
    expect(text()).toContain('@ann');
    expect(rowValue('Joined')).toMatch(/2026/);
    expect(rowValue('Trainer level')).toBe('6'); // 2,500 lifetime points
    expect(rowValue('Points')).toBe('450 pts');
    expect(rowValue('Rank among your friends')).toBe('#2 of 3');
    expect([rowValue('Check-ins'), rowValue('Cities'), rowValue('Countries')]).toEqual(['12', '3', '2']);
    expect(rowValue('Solo streak')).toContain('6 days');
    expect([rowValue('Landmark'), rowValue('City'), rowValue('Date')].slice(0, 2)).toEqual(['Freedom Tower', 'Miami']);
    expect(rowValue('Date')).toMatch(/2026/);
    expect(button('Remove friend')).toBeTruthy();
    expect(button('Block')).toBeTruthy();
  });

  it('shows nothing it should not: no badges, pair streaks, map, home or email', async () => {
    await mount();
    expect(text()).not.toMatch(/badge|pair|streak with|1 Secret St|example\.com|home/i);
    expect(container.querySelector('.leaflet-container, .map, [class*="map"]')).toBeNull();
  });

  it('points use the leaderboard period the leaderboard tabs are on', async () => {
    const { writePersisted } = await import('../lib/usePersistentState');
    writePersisted('leaderboard.period', 'monthly');
    const { getFriendsLeaderboard } = await import('../lib/leaderboard');
    getFriendsLeaderboard.mockClear();
    await mount();
    expect(getFriendsLeaderboard.mock.calls[0][0]).toBe('monthly');
  });

  it('hides the solo streak row when they have none', async () => {
    streak = { soloStreak: null };
    await mount();
    expect(rowValue('Solo streak')).toBeUndefined();
  });

  it('shows – for missing values and keeps every row', async () => {
    stats = null;
    board = [];
    checkins = [];
    profile = { ...profile, displayName: '', createdAt: null };
    await mount();
    for (const label of ['Joined', 'Trainer level', 'Points', 'Rank among your friends', 'Check-ins', 'Cities', 'Countries', 'Landmark', 'City', 'Date']) {
      expect(rowValue(label)).toBe('–');
    }
  });

  it('a private profile shows only the header and a note, with Remove and Block', async () => {
    profile = { ...profile, public: false };
    await mount();
    expect(text()).toContain('Private profile');
    expect(rowValue('Joined')).toMatch(/2026/);
    expect(rowValue('Points')).toBeUndefined();
    expect(rowValue('Check-ins')).toBeUndefined();
    expect(rowValue('Landmark')).toBeUndefined();
    expect(button('Remove friend')).toBeTruthy();
    expect(button('Block')).toBeTruthy();
  });

  it('a user you blocked cannot open the page', async () => {
    blocked = [{ blockedUid: 'ann' }];
    await mount();
    expect(text()).toContain("This profile isn't available");
    expect(button('Block')).toBeUndefined();
  });

  it('a user who blocked you cannot open it either (the server says unavailable)', async () => {
    api.getFriendSoloStreak = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'unavailable' });
    });
    await mount();
    expect(text()).toContain("This profile isn't available");
    api.getFriendSoloStreak = vi.fn(async () => streak);
  });

  it('Remove friend asks, then ends the friendship and goes back to Profile', async () => {
    await mount();
    await act(async () => button('Remove friend').click());
    await act(async () => [...document.querySelectorAll('.save-sheet-actions button')].pop().click());
    expect(api.removeFriend).toHaveBeenCalledWith('ann');
    expect(container.querySelector('.where').textContent).toBe('/profile');
  });

  it('Block asks, then blocks, ends the friendship and goes back to Profile', async () => {
    await mount();
    await act(async () => button('Block').click());
    await act(async () => [...document.querySelectorAll('.save-sheet-actions button')].pop().click());
    expect(blockUser).toHaveBeenCalledWith('me', 'ann', 'ann');
    expect(api.removeFriend).toHaveBeenCalledWith('ann');
    expect(container.querySelector('.where').textContent).toBe('/profile');
  });
});
