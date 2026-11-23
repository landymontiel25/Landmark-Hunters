import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => 'now' } }));
vi.mock('./leaderboardPoints.js', () => ({ cleanUserName: (n) => n || 'Explorer', leaderboardPointWrites: () => [] }));
const { referralDecision, payReferral, phoneKey, REFERRALS_PER_MONTH, REFERRALS_LIFETIME } = await import('./referralBonus.js');

const referral = { referrerUid: 'ref', referredUid: 'new', referredClaimed: false, referrerClaimed: false };
const month = '2026-11';

describe('referral decision', () => {
  it('needs a verified phone, an unused number, a verified visit, and room under the caps', () => {
    const ok = { referral, phone: '+13055550100', phoneUsedBy: null, verifiedVisit: true, referrerStats: null, month };
    expect(referralDecision(ok)).toEqual({ pay: true });
    expect(referralDecision({ ...ok, phone: null }).reason).toBe('needs-phone');
    expect(referralDecision({ ...ok, phoneUsedBy: 'someone-else' }).reason).toBe('phone-used');
    expect(referralDecision({ ...ok, verifiedVisit: false }).reason).toBe('needs-verified-checkin');
    expect(referralDecision({ ...ok, referrerStats: { total: REFERRALS_LIFETIME } }).reason).toBe('referrer-cap');
    expect(referralDecision({ ...ok, referrerStats: { total: 1, month, monthCount: REFERRALS_PER_MONTH } }).reason).toBe('referrer-month-cap');
    expect(referralDecision({ ...ok, referrerStats: { total: 1, month: '2026-10', monthCount: REFERRALS_PER_MONTH } })).toEqual({ pay: true });
    expect(referralDecision({ ...ok, referral: { ...referral, referredClaimed: true, referrerClaimed: true } }).reason).toBe('already');
  });
});

function fakeDb(initial) {
  const docs = new Map(Object.entries(initial));
  const ref = (path) => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) });
  return {
    docs,
    collection: (n) => ({
      doc: (id) => ref(`${n}/${id}`),
      where: (_f, _o, v) => ({ get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.startsWith(`${n}/`) && d.userId === v).map(([, d]) => ({ data: () => d })) }) }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        set: (r, d, o) => docs.set(r.path, o?.merge ? { ...(docs.get(r.path) || {}), ...d } : d),
        update: (r, d) => docs.set(r.path, { ...docs.get(r.path), ...d }),
      }),
  };
}

describe('paying a referral', () => {
  const base = () => ({ 'referrals/new': { ...referral }, 'users/new': { username: 'n' }, 'users/ref': { username: 'r' } });
  const verified = { userId: 'new', visited: true, presence: { verified: true } };

  it('pays both sides once, records the phone and the referrer count', async () => {
    const db = fakeDb({ ...base(), 'checkins/new_x': verified });
    const out = await payReferral(db, 'new', { authUser: async () => ({ phoneNumber: '+13055550100' }) });
    expect(out).toMatchObject({ paid: true, points: 50 });
    expect(db.docs.get('users/new').bonusPoints).toEqual({ __inc: 50 });
    expect(db.docs.get('users/ref').bonusPoints).toEqual({ __inc: 50 });
    expect(db.docs.get(`referral_phones/${phoneKey('+13055550100')}`)).toMatchObject({ referredUid: 'new' });
    expect(db.docs.get('referral_stats/ref')).toMatchObject({ total: 1, monthCount: 1 });
    expect((await payReferral(db, 'new', { authUser: async () => ({ phoneNumber: '+13055550100' }) })).reason).toBe('already');
  });

  it('exploit: a throwaway account (email only, no visit) pays nobody', async () => {
    const db = fakeDb(base());
    expect((await payReferral(db, 'new', { authUser: async () => ({ phoneNumber: null }) })).reason).toBe('needs-phone');
    expect((await payReferral(db, 'new', { authUser: async () => ({ phoneNumber: '+13055550100' }) })).reason).toBe('needs-verified-checkin');
    expect(db.docs.get('users/new').bonusPoints).toBeUndefined();
  });

  it('exploit: the same phone number on a second account pays nothing', async () => {
    const db = fakeDb({ ...base(), 'checkins/new_x': verified, [`referral_phones/${phoneKey('+13055550100')}`]: { referredUid: 'first' } });
    expect((await payReferral(db, 'new', { authUser: async () => ({ phoneNumber: '+13055550100' }) })).reason).toBe('phone-used');
  });
});

describe('a lookup that fails', () => {
  it('reads as "no phone", never a crash', async () => {
    const db = fakeDb({ 'referrals/new': { ...referral } });
    const out = await payReferral(db, 'new', {
      authUser: () => {
        throw new TypeError('not a function');
      },
    });
    expect(out.reason).toBe('needs-phone');
  });
});
