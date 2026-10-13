// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ following: false, fail: false }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/reputationApi', () => ({ getReputation: vi.fn(async (uid) => (uid === 'x' ? { levels: { philly: 'Trusted' }, badges: [] } : null)) }));
vi.mock('../lib/tasteMatch', () => ({ tasteMatchFor: vi.fn(async (_me, uid) => (uid === 'x' ? 'High' : null)) }));
vi.mock('../lib/friends', () => ({ getUserProfile: vi.fn(async () => ({ uid: 'x', public: true, followerCount: 4 })) }));
vi.mock('../lib/followsApi', () => ({
  isFollowing: vi.fn(async () => api.following),
  followUser: vi.fn(async () => {
    if (api.fail) throw Object.assign(new Error('no'), { userMessage: 'Only public profiles can be followed.' });
    return { ok: true };
  }),
  unfollowUser: vi.fn(async () => ({ ok: true })),
}));

import FollowButton from './FollowButton';

let container;
let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.following = false;
  api.fail = false;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});
const mount = async (el) => {
  root = createRoot(container);
  await act(async () => root.render(el));
  await act(async () => {});
};
const button = () => container.querySelector('button');
const text = () => container.textContent;

describe('FollowButton', () => {
  it('shows the count and follows a public profile', async () => {
    await mount(<FollowButton uid="x" />);
    expect(text()).toContain('4 followers');
    expect(text()).toContain('Taste match: High');
    expect(text()).toContain('Trusted in Philadelphia');
    expect(text()).not.toMatch(/\d+%/);
    expect(button().textContent).toBe('Follow');
    await act(async () => button().click());
    expect(button().textContent).toBe('Following');
    expect(text()).toContain('5 followers');
  });
  it('flips back when the server refuses', async () => {
    api.fail = true;
    await mount(<FollowButton uid="x" />);
    await act(async () => button().click());
    expect(button().textContent).toBe('Follow');
    expect(text()).toContain('4 followers');
  });
  it('a private profile shows its count with no button', async () => {
    await mount(<FollowButton uid="x" profile={{ uid: 'x', public: false, followerCount: 1 }} />);
    expect(text()).toContain('1 follower');
    expect(button()).toBeNull();
  });
  it('a private profile you already follow can be unfollowed', async () => {
    api.following = true;
    await mount(<FollowButton uid="x" profile={{ uid: 'x', public: false, followerCount: 1 }} />);
    expect(button().textContent).toBe('Following');
  });
  it('shows nothing to click on your own profile', async () => {
    await mount(<FollowButton uid="me" profile={{ uid: 'me', public: true, followerCount: 2 }} />);
    expect(text()).toContain('2 followers');
    expect(button()).toBeNull();
  });
});
