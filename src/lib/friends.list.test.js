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
      getDoc: async (ref) =>
        ref.path === 'users/u2'
          ? { exists: () => true, data: () => ({ username: 'ana_new' }) }
          : { exists: () => false, data: () => undefined },
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
