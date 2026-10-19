// @vitest-environment jsdom
// Owner, 2026-10-18: the header's dual streak badge becomes standings:
// your points for the period, a dropdown with rank and the top of the board.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { boards, asked, auth } = vi.hoisted(() => ({
  // One stable object, like the real AuthContext (a new one each render
  // re-runs every effect keyed on user).
  auth: { user: { uid: 'me' }, firebaseEnabled: true },
  boards: {
    weekly: [
      { userId: 'amy', userName: 'amy', points: 120 },
      { userId: 'me', userName: 'me', points: 80 },
      { userId: 'bo', userName: 'bo', points: 40 },
    ],
    monthly: [{ userId: 'me', userName: 'me', points: 900 }],
  },
  asked: [],
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', requests: [] }) }));
vi.mock('../lib/AdminModeContext', () => ({ useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: vi.fn() }) }));
vi.mock('../lib/soloStreaks', () => ({
  ensureSoloStreak: async () => ({}),
  watchNewCheckins: () => () => {},
  closeSoloToday: async () => ({}),
  subscribeMySoloStreak: () => () => {},
}));
vi.mock('../lib/leaderboard', () => ({
  subscribeLeaderboard: (period, onData) => {
    asked.push(period);
    onData(boards[period] || []);
    return () => {};
  },
  rankOf: (entries, idx) => entries.findIndex((x) => x.points === entries[idx].points) + 1,
  getMyLeaderboardEntry: async () => null,
  cleanName: (n) => n,
}));
vi.mock('../lib/notifications', () => ({ subscribeMyNotifications: () => () => {} }));

const { default: Header } = await import('./Header.jsx');

let container;
afterEach(() => {
  container?.remove();
  localStorage.clear();
});

describe('Header standings badge', () => {
  it('shows your points, and the dropdown has your rank, who is ahead and the top of the board', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<MemoryRouter><Header /></MemoryRouter>));
    const badge = container.querySelector('.header-standings');
    expect(badge.textContent).toContain('80');
    expect(container.textContent).not.toContain('\u{1F525}\u{1F525}');
    await act(async () => badge.click());
    const pop = document.querySelector('.standings-pop');
    expect(pop.textContent).toContain('#2');
    expect(pop.textContent).toContain('40 pts behind @amy');
    expect([...pop.querySelectorAll('.standings-name')].map((n) => n.textContent)).toEqual(['@amy', '@me', '@bo']);
    const month = [...pop.querySelectorAll('.standings-tabs button')].find((b) => b.textContent === 'Month');
    await act(async () => month.click());
    expect(asked).toContain('monthly');
    expect(badge.textContent).toContain('900');
    const { readPersisted } = await import('../lib/usePersistentState');
    expect(readPersisted('leaderboard.period')).toBe('monthly');
  });
});
