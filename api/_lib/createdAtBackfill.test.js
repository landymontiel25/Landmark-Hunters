import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { fromMillis: (ms) => ({ ms }) },
}));
const { chooseCreatedAt, backfillCreatedAt } = await import('./createdAtBackfill.js');

describe('chooseCreatedAt', () => {
  it('prefers the Auth account creation time', () => {
    expect(chooseCreatedAt({ authCreationTime: 'Mon, 01 Jan 2024 00:00:00 GMT', firstRatingMs: 5 })).toEqual({ ms: Date.parse('2024-01-01T00:00:00Z'), source: 'auth' });
  });
  it('falls back to the first rating when Auth has nothing', () => {
    expect(chooseCreatedAt({ authCreationTime: undefined, firstRatingMs: 123 })).toEqual({ ms: 123, source: 'first-rating' });
    expect(chooseCreatedAt({ authCreationTime: 'not a date', firstRatingMs: 123 }).source).toBe('first-rating');
  });
  it('is null with neither', () => {
    expect(chooseCreatedAt({})).toBeNull();
  });
});

describe('backfillCreatedAt', () => {
  const stamp = (ms) => ({ toMillis: () => ms });
  function setup({ users, authTimes, reviews = {} }) {
    const sets = [];
    const docs = users.map((u) => ({ id: u.id, data: () => u.data, ref: { set: async (d, o) => sets.push([u.id, d, o]) } }));
    const db = {
      collection: (name) => {
        if (name === 'users') return { orderBy: () => ({ limit: () => ({ get: async () => ({ docs }) }) }) };
        return {
          where: (_f, _o, uid) => ({ get: async () => ({ docs: (reviews[uid] || []).map((r) => ({ data: () => r })) }) }),
        };
      },
    };
    const auth = { getUsers: async (ids) => ({ users: ids.filter((i) => authTimes[i.uid]).map((i) => ({ uid: i.uid, metadata: { creationTime: authTimes[i.uid] } })) }) };
    return { db, auth, sets };
  }

  it('fills only users without createdAt: Auth time first, first rating otherwise, and reports which', async () => {
    const { db, auth, sets } = setup({
      users: [
        { id: 'has', data: { createdAt: stamp(1) } },
        { id: 'viaAuth', data: {} },
        { id: 'viaRating', data: {} },
        { id: 'nothing', data: {} },
      ],
      authTimes: { viaAuth: 'Mon, 01 Jan 2024 00:00:00 GMT' },
      reviews: { viaRating: [{ ratedAt: 9000, updatedAt: stamp(8000) }, { updatedAt: stamp(5000) }], nothing: [] },
    });
    const r = await backfillCreatedAt(db, auth, { max: 50 });
    expect(r).toMatchObject({ scanned: 4, updated: 2, fromAuth: 1, fromFirstRating: 1, noSource: 1, done: true });
    expect(sets.map((s) => s[0]).sort()).toEqual(['viaAuth', 'viaRating']);
    expect(sets.find((s) => s[0] === 'viaAuth')[1]).toEqual({ createdAt: { ms: Date.parse('2024-01-01T00:00:00Z') } });
    expect(sets.find((s) => s[0] === 'viaRating')[1].createdAt.ms).toBe(5000);
    expect(sets.every((s) => s[2]?.merge === true)).toBe(true);
  });
  it('is done and writes nothing when everyone already has createdAt', async () => {
    const { db, auth, sets } = setup({ users: [{ id: 'a', data: { createdAt: stamp(1) } }], authTimes: {} });
    const r = await backfillCreatedAt(db, auth);
    expect(r).toMatchObject({ updated: 0, done: true });
    expect(sets).toEqual([]);
  });
  it('stops at the per-call maximum so it can be called again', async () => {
    const { db, auth, sets } = setup({ users: ['a', 'b', 'c'].map((id) => ({ id, data: {} })), authTimes: { a: 'Mon, 01 Jan 2024 00:00:00 GMT', b: 'Mon, 01 Jan 2024 00:00:00 GMT', c: 'Mon, 01 Jan 2024 00:00:00 GMT' } });
    const r = await backfillCreatedAt(db, auth, { max: 2 });
    expect(sets).toHaveLength(2);
    expect(r.done).toBe(false);
  });
});
