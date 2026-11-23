import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now', delete: () => '__delete__' } }));
const { splitPrivate, backfillPrivateProfiles } = await import('./privateProfileBackfill.js');

describe('private fields on old public profiles (anti-farming item 7)', () => {
  it('picks out only the private fields', () => {
    expect(splitPrivate({ uid: 'u', username: 'n', email: 'A@B.com', homeCoords: { lat: 1, lng: 2 } })).toEqual({ email: 'a@b.com', homeCoords: { lat: 1, lng: 2 } });
    expect(splitPrivate({ uid: 'u', username: 'n' })).toBeNull();
  });
  it('moves them to the private doc and deletes them from the public one', async () => {
    const docs = new Map([['users/u1', { uid: 'u1', username: 'n', email: 'x@y.com' }], ['users/u2', { uid: 'u2' }]]);
    const ref = (path) => ({
      path,
      collection: (c) => ({ doc: (id) => ref(`${path}/${c}/${id}`) }),
    });
    const db = {
      collection: () => ({
        doc: (id) => ref(`users/${id}`),
        orderBy: (k) => ({ limit: () => ({ select: () => ({ get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.split('/').length === 2 && d[k] !== undefined).map(([p]) => ({ id: p.split('/')[1] })) }) }) }) }),
      }),
      runTransaction: async (fn) =>
        fn({
          get: async (r) => ({ exists: docs.has(r.path), data: () => docs.get(r.path) }),
          set: (r, d) => docs.set(r.path, { ...(docs.get(r.path) || {}), ...d }),
          update: (r, d) => {
            const cur = { ...docs.get(r.path) };
            for (const [k, v] of Object.entries(d)) if (v === '__delete__') delete cur[k];
            docs.set(r.path, cur);
          },
        }),
    };
    expect(await backfillPrivateProfiles(db)).toEqual({ checked: 1, moved: 1 });
    expect(docs.get('users/u1')).toEqual({ uid: 'u1', username: 'n' });
    expect(docs.get('users/u1/private/main')).toMatchObject({ email: 'x@y.com' });
  });
});
