import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function load({ edgeExists = false, incoming = [] } = {}) {
  const setDoc = vi.fn(async () => {});
  vi.doMock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: async () => ({ exists: () => edgeExists }),
    getDocs: async () => ({ docs: incoming.map((d) => ({ data: () => d })) }),
    collection: (_db, name) => ({ name }),
    query: (c) => c,
    where: () => ({}),
    setDoc,
    serverTimestamp: () => 'ts',
  }));
  vi.doMock('./firebase', () => ({ db: {} }));
  vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
  const mod = await import('./friends.js');
  return { ...mod, setDoc };
}

const me = { uid: 'me', username: 'me' };
const them = { uid: 'them', username: 'them' };

describe('requestKey', () => {
  it('differs for a re-sent request that reuses the same doc id', async () => {
    const { requestKey } = await load();
    const a = { id: 'a_b', createdAt: { seconds: 100, nanoseconds: 1 } };
    const b = { id: 'a_b', createdAt: { seconds: 200, nanoseconds: 5 } };
    expect(requestKey(a)).not.toBe(requestKey(b));
    expect(requestKey(a)).toBe(requestKey({ ...a }));
  });
});

describe('sendFriendRequest', () => {
  it('does not create a crossing request when they already asked you', async () => {
    const { sendFriendRequest, setDoc } = await load({ incoming: [{ from: 'them', to: 'me' }] });
    await expect(sendFriendRequest(me, them)).rejects.toMatchObject({ userMessage: expect.stringContaining('already sent you') });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('sends normally when nothing is pending the other way', async () => {
    const { sendFriendRequest, setDoc } = await load({ incoming: [{ from: 'someone-else', to: 'me' }] });
    await sendFriendRequest(me, them);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});
