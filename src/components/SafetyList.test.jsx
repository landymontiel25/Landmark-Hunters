// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  user: { uid: 'me' },
  blocked: [{ blockedUid: 'bob', blockedName: 'bob' }],
  reports: [{ id: 'comment_x', kind: 'comment', label: '@cat on Cafe', landmarkId: 'cafe', regionId: 'miami', createdAt: { seconds: 1761600000 } }],
  unblock: vi.fn(async () => {}),
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ reload: async () => {} }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }), runOptimistic: async ({ apply, commit }) => { apply?.(); await commit(); } }));
vi.mock('../lib/blocks', () => ({ listBlockedUsers: async () => h.blocked, unblockUser: h.unblock }));
vi.mock('../lib/myReports', () => ({ listMyReports: async () => h.reports }));

import SafetyList from './SafetyList';

let container;
afterEach(() => container?.remove());
async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<MemoryRouter><SafetyList /></MemoryRouter>));
}

describe('Blocked & Reported list', () => {
  it('shows who you blocked and what you reported, and Unblock works', async () => {
    await render();
    expect(container.textContent).toContain('Blocked & Reported');
    expect(container.textContent).toContain('@bob');
    expect(container.textContent).toContain('Comment: @cat on Cafe');
    expect(container.querySelector('a[href="/landmarks/miami/cafe"]')).toBeTruthy();
    const un = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Unblock');
    await act(async () => un.click());
    expect(h.unblock).toHaveBeenCalledWith('me', 'bob');
    expect(container.textContent).toContain('No one blocked.');
  });
});
