import { describe, it, expect, vi } from 'vitest';
import { awardLandmarkBonus, landmarkBonusDecision } from './landmarkBonus.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => 'now' } }));

const TOWER = 'osm-w435585913';
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const apply = (cur, patch) => {
    const next = { ...(cur || {}) };
    for (const [k, v] of Object.entries(patch)) next[k] = v && v.__inc != null ? (Number(next[k]) || 0) + v.__inc : v;
    return next;
  };
  const ref = (path) => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) });
  const query = (name, filters) => ({
    where: (f, _op, v) => query(name, [...filters, [f, v]]),
    get: async () => ({
      docs: [...docs.entries()].filter(([p, d]) => p.startsWith(`${name}/`) && filters.every(([f, v]) => d[f] === v)).map(([, d]) => ({ data: () => d })),
    }),
  });
  return {
    docs,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`), where: (f, op, v) => query(name, [[f, v]]) }),
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        create: (r, d) => {
          if (docs.has(r.path)) throw new Error('exists');
          docs.set(r.path, apply(null, d));
        },
        set: (r, d, o) => docs.set(r.path, o?.merge ? apply(docs.get(r.path), d) : apply(null, d)),
      }),
  };
}

describe('the Alhambra Water Tower bonus', () => {
  it('decides: a special place, a real visit, not paid before', () => {
    const special = { bonusPoints: 1000 };
    expect(landmarkBonusDecision({ special: null, checkins: [], paid: false }).reason).toBe('not-special');
    expect(landmarkBonusDecision({ special, checkins: [{ ratingOnly: true }], paid: false }).reason).toBe('no-checkin');
    expect(landmarkBonusDecision({ special, checkins: [{ visited: true }], paid: true }).reason).toBe('already');
    expect(landmarkBonusDecision({ special, checkins: [{ visited: true }], paid: false })).toEqual({ awarded: 1000 });
  });

  it('pays 1,000 once for a real check-in: lifetime points and the boards', async () => {
    const db = fakeDb({ [`checkins/u_${TOWER}`]: { userId: 'u', userName: 'Alex', landmarkId: TOWER, region: 'miami', visited: true, points: 0 } });
    expect((await awardLandmarkBonus(db, 'u', 'miami', TOWER, '2026-9-21')).awarded).toBe(1000);
    expect(db.docs.get('users/u').bonusPoints).toBe(1000);
    expect([...db.docs.keys()].filter((k) => k.startsWith('leaderboard_entries/'))).toHaveLength(3);
    expect((await awardLandmarkBonus(db, 'u', 'miami', TOWER, '2026-9-21')).reason).toBe('already');
    expect(db.docs.get('users/u').bonusPoints).toBe(1000);
  });

  it('pays nothing without a real visit there, or at an ordinary place', async () => {
    const db = fakeDb({ [`checkins/u_${TOWER}`]: { userId: 'u', landmarkId: TOWER, ratingOnly: true, visited: false, points: 0 } });
    expect((await awardLandmarkBonus(db, 'u', 'miami', TOWER, '2026-9-21')).reason).toBe('no-checkin');
    expect((await awardLandmarkBonus(db, 'u', 'miami', 'some-place', '2026-9-21')).reason).toBe('not-special');
    expect(db.docs.has('users/u')).toBe(false);
  });
});
