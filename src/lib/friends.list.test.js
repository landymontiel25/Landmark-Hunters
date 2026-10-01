import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('sendFriendRequest re-send', () => {
  it('explains an already-pending request instead of attempting a rules-denied overwrite', async () => {
    const setDoc = vi.fn(async () => {});
    vi.doMock('firebase/firestore', () => ({
      doc: (_db, ...path) => ({ path: path.join('/') }),
      getDoc: async () => ({ exists: () => false }),
      getDocs: async () => ({ docs: [{ data: () => ({ from: 'me', to: 'them' }) }] }),
      collection: (_db, name) => ({ name }),
      query: (c) => c,
      where: () => ({}),
      setDoc,
      serverTimestamp: () => 'ts',
    }));
    vi.doMock('./firebase', () => ({ db: {} }));
    vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
    const { sendFriendRequest } = await import('./friends.js');
    await expect(sendFriendRequest({ uid: 'me', username: 'me' }, { uid: 'them', username: 'them' })).rejects.toMatchObject({
      userMessage: expect.stringContaining('already sent @them'),
    });
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('listFriends', () => {
  it("shows a friend's current username, not the one stored when they were added", async () => {
    vi.doMock('firebase/firestore', () => ({
      doc: (_db, ...path) => ({ path: path.join('/') }),
      getDoc: async (ref) => {
        if (ref.path === 'users/u3') throw new Error('offline');
        return ref.path === 'users/u2'
          ? { exists: () => true, data: () => ({ username: 'ana_new' }) }
          : { exists: () => false, data: () => undefined };
      },
      getDocs: async () => ({
        docs: [
          { data: () => ({ owner: 'me', friend: 'u2', friendName: 'ana_old' }) },
          { data: () => ({ owner: 'me', friend: 'u3', friendName: 'bob' }) },
        ],
      }),
      collection: (_db, name) => ({ name }),
      query: (c) => c,
      where: () => ({}),
    }));
    vi.doMock('./firebase', () => ({ db: {} }));
    vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
    const { listFriends } = await import('./friends.js');
    const out = await listFriends('me');
    expect(out.map((f) => f.friendName)).toEqual(['ana_new', 'bob']);
  });
});

describe('listFriends and a friend who deleted their account', () => {
  it('drops the ghost and clears your own half of the friendship, keeps friends it could not read', async () => {
    const deleteDoc = vi.fn(async () => {});
    vi.doMock('firebase/firestore', () => ({
      doc: (_db, ...path) => ({ path: path.join('/') }),
      getDoc: async (ref) => {
        if (ref.path === 'users/gone') return { exists: () => false, data: () => undefined };
        if (ref.path === 'users/flaky') throw new Error('offline');
        return { exists: () => true, data: () => ({ username: 'here_now' }) };
      },
      getDocs: async () => ({
        docs: [
          { data: () => ({ owner: 'me', friend: 'gone', friendName: 'ghost' }) },
          { data: () => ({ owner: 'me', friend: 'flaky', friendName: 'flaky_old' }) },
          { data: () => ({ owner: 'me', friend: 'here', friendName: 'here_old' }) },
        ],
      }),
      collection: (_db, name) => ({ name }),
      query: (c) => c,
      where: () => ({}),
      deleteDoc,
    }));
    vi.doMock('./firebase', () => ({ db: {} }));
    vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
    const { listFriends } = await import('./friends.js');
    const out = await listFriends('me');
    expect(out.map((f) => f.friendName)).toEqual(['flaky_old', 'here_now']);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'friend_edges/me_gone' });
  });

  it('never deletes an edge on a cache-only "missing" answer', async () => {
    const deleteDoc = vi.fn(async () => {});
    vi.doMock('firebase/firestore', () => ({
      doc: (_db, ...path) => ({ path: path.join('/') }),
      getDoc: async () => ({ exists: () => false, data: () => undefined, metadata: { fromCache: true } }),
      getDocs: async () => ({ docs: [{ data: () => ({ owner: 'me', friend: 'cached', friendName: 'c' }) }] }),
      collection: (_db, name) => ({ name }),
      query: (c) => c,
      where: () => ({}),
      deleteDoc,
    }));
    vi.doMock('./firebase', () => ({ db: {} }));
    vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
    const { listFriends } = await import('./friends.js');
    const out = await listFriends('me');
    expect(out).toHaveLength(1);
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});
