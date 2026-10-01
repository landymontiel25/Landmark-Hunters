// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
});

async function setup(friendsMock) {
  const state = { authUser: { uid: 'A' } };
  vi.doMock('./AuthContext', () => ({ useAuth: () => ({ user: state.authUser }) }));
  vi.doMock('./firebase', () => ({ firebaseEnabled: true }));
  vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
  vi.doMock('./leaderboard', () => ({ backfillUserName: async () => {} }));
  vi.doMock('./friends', () => ({
    upsertUserProfile: async () => {},
    claimUsername: async () => {},
    subscribeUserProfile: () => () => {},
    subscribeMyPrivateProfile: () => () => {},
    migratePrivateProfile: async () => {},
    publishAdminPointer: async () => {},
    ...friendsMock,
  }));
  const { FriendsProvider, useFriends } = await import('./FriendsContext.jsx');
  const probe = {};
  function Probe() {
    probe.ctx = useFriends();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const render = () =>
    act(async () =>
      root.render(
        <FriendsProvider>
          <Probe />
        </FriendsProvider>
      )
    );
  return { state, probe, render };
}

describe('FriendsProvider switching accounts', () => {
  it("never shows the previous account's profile, friends or requests to the next one", async () => {
    // B's reads never land (slow network); A's data is what's left behind.
    const { state, probe, render } = await setup({
      getUserProfile: (uid) => (uid === 'A' ? Promise.resolve({ username: 'alice' }) : new Promise(() => {})),
      listFriends: (uid) => (uid === 'A' ? Promise.resolve([{ friend: 'F1' }]) : new Promise(() => {})),
      listIncomingRequests: (uid) => (uid === 'A' ? Promise.resolve([{ id: 'r1' }]) : new Promise(() => {})),
    });
    await render();
    expect(probe.ctx.myUsername).toBe('alice');
    expect(probe.ctx.friendUids.has('F1')).toBe(true);

    state.authUser = { uid: 'B' };
    await render();
    expect(probe.ctx.myUsername).toBe(null);
    expect(probe.ctx.friendUids.size).toBe(0);
    expect(probe.ctx.requests).toEqual([]);
  });

  it('ignores a slow load that finishes after the account changed', async () => {
    let finishA;
    const { state, probe, render } = await setup({
      getUserProfile: (uid) => (uid === 'A' ? new Promise((r) => (finishA = r)) : Promise.resolve({ username: 'bob' })),
      listFriends: async () => [],
      listIncomingRequests: async () => [],
    });
    await render();
    state.authUser = { uid: 'B' };
    await render();
    expect(probe.ctx.myUsername).toBe('bob');
    await act(async () => finishA({ username: 'alice' }));
    expect(probe.ctx.myUsername).toBe('bob');
  });
});
