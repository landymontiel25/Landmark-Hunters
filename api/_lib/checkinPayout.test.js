import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => 'now' } }));
vi.mock('./leaderboardPoints.js', () => ({
  cleanUserName: (n) => n || 'Explorer',
  leaderboardPointWrites: (db, uid, name, pts) => [[{ path: `leaderboard_entries/weekly_${uid}` }, { points: { __inc: pts } }]],
}));
const { checkinPayoutDecision, payVerifiedCheckin } = await import('./checkinPayout.js');

const visit = { userId: 'u', userName: 'Alex', landmarkId: 'x', visited: true, ratingOnly: false, points: 0 };

function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const ref = (path) => ({ path, id: path.split('/')[1], get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) });
  return {
    docs,
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      where: (_f, _o, uid) => ({
        select: () => ({ get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.startsWith(`${name}/`) && d.userId === uid).map(([p, d]) => ({ id: p.split('/')[1], data: () => d })) }) }),
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        create: (r, data) => {
          if (docs.has(r.path)) throw new Error('exists');
          docs.set(r.path, data);
        },
        update: (r, data) => docs.set(r.path, { ...docs.get(r.path), ...data }),
        set: (r, data) => docs.set(r.path, { ...(docs.get(r.path) || {}), ...data }),
      }),
  };
}

describe('check-in points, paid by the server', () => {
  it('pays only a verified, real visit, once', () => {
    expect(checkinPayoutDecision({ checkin: visit, verified: false, paid: false, paidBefore: false })).toMatchObject({ awarded: 0, reason: 'not-verified' });
    expect(checkinPayoutDecision({ checkin: { ...visit, ratingOnly: true, visited: false }, verified: true, paid: false, paidBefore: false }).reason).toBe('not-a-visit');
    expect(checkinPayoutDecision({ checkin: visit, verified: true, paid: true, paidBefore: false }).reason).toBe('already');
    expect(checkinPayoutDecision({ checkin: visit, verified: true, paid: false, paidBefore: true }).reason).toBe('already');
    expect(checkinPayoutDecision({ checkin: visit, verified: true, paid: false, paidBefore: false })).toEqual({ awarded: 100 });
  });

  it('a verified first check-in: 100 on the check-in, the payout marker and the boards; never twice', async () => {
    const db = fakeDb({ 'checkins/u_x': { ...visit, presence: { verified: true } } });
    expect(await payVerifiedCheckin(db, 'u', 'u_x', '2026-10-23')).toEqual({ awarded: 100 });
    expect(db.docs.get('checkins/u_x').points).toBe(100);
    expect(db.docs.get('checkin_payouts/u')).toMatchObject({ checkinId: 'u_x', points: 100 });
    expect(db.docs.get('leaderboard_entries/weekly_u').points).toEqual({ __inc: 100 });
    db.docs.set('checkins/u_y', { ...visit, landmarkId: 'y', presence: { verified: true } });
    expect((await payVerifiedCheckin(db, 'u', 'u_y', '2026-10-23')).awarded).toBe(0);
  });

  it('an unverified check-in pays nothing, and an account paid under the old rule is not paid again', async () => {
    const db = fakeDb({ 'checkins/u_x': { ...visit, presence: { verified: false, reason: 'too-far' } } });
    expect((await payVerifiedCheckin(db, 'u', 'u_x', '2026-10-23')).awarded).toBe(0);
    const old = fakeDb({ 'checkins/u_old': { ...visit, points: 100 }, 'checkins/u_x': { ...visit, presence: { verified: true } } });
    expect((await payVerifiedCheckin(old, 'u', 'u_x', '2026-10-23')).reason).toBe('already');
  });
});
