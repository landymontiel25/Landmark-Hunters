import { describe, it, expect, vi } from 'vitest';
import { storagePath, sweepDeletedAccounts } from './accountWipe.js';
import { signInAgeMs, RECENT_SIGN_IN_MS } from '../account.js';

const snap = (docs) => ({ docs });
function fakeDb({ chatOwners = [], userIds = [] }) {
  return {
    collection: (name) => ({
      select: () => ({
        get: async () => (name === 'mapr_chats' ? snap(chatOwners.map((o) => ({ data: () => ({ ownerUid: o }) }))) : snap(userIds.map((id) => ({ id })))),
      }),
    }),
  };
}
const authWith = (live) => ({ getUsers: async (ids) => ({ users: ids.filter((x) => live.includes(x.uid)).map((x) => ({ uid: x.uid })) }) });

describe('account wipe (App Store rule 5.1.1(v), owner 2026-11-23)', () => {
  it('reads a Storage path out of a download URL in this bucket only', () => {
    expect(storagePath('https://firebasestorage.googleapis.com/v0/b/bk/o/checkin_photos%2Flm%2Fu1_1.jpg?alt=media&token=t', 'bk')).toBe('checkin_photos/lm/u1_1.jpg');
    expect(storagePath('https://firebasestorage.googleapis.com/v0/b/other/o/x.jpg?alt=media', 'bk')).toBeNull();
    expect(storagePath('gs://bk/avatars/u1.jpg', 'bk')).toBe('avatars/u1.jpg');
    expect(storagePath(null, 'bk')).toBeNull();
  });

  it('the nightly sweep wipes only accounts that no longer exist', async () => {
    const wipe = vi.fn(async () => ({ errors: [] }));
    const db = fakeDb({ chatOwners: ['gone1', 'alive', 'gone1'], userIds: ['alive', 'gone2'] });
    const out = await sweepDeletedAccounts(db, authWith(['alive']), { wipe });
    expect(wipe.mock.calls.map((c) => c[1]).sort()).toEqual(['gone1', 'gone2']);
    expect(out).toMatchObject({ checked: 3, wiped: 2 });
  });

  it('never wipes on a broken lookup or when too many accounts look missing', async () => {
    const wipe = vi.fn(async () => ({ errors: [] }));
    const many = Array.from({ length: 40 }, (_, i) => `u${i}`);
    expect((await sweepDeletedAccounts(fakeDb({ userIds: many }), authWith([]), { wipe })).aborted).toBeTruthy();
    expect((await sweepDeletedAccounts(fakeDb({ userIds: many }), authWith(many.slice(0, 20)), { wipe })).aborted).toBeTruthy();
    expect(wipe).not.toHaveBeenCalled();
    const failing = { getUsers: async () => { throw new Error('down'); } };
    await expect(sweepDeletedAccounts(fakeDb({ userIds: ['a'] }), failing, { wipe })).rejects.toThrow('down');
    expect(wipe).not.toHaveBeenCalled();
  });

  it('the wipe endpoint needs a sign-in from the last 10 minutes', () => {
    const tok = (authTime) => ({ headers: { authorization: `Bearer x.${Buffer.from(JSON.stringify({ auth_time: authTime })).toString('base64url')}.y` } });
    const now = 1_800_000_000_000;
    expect(signInAgeMs(tok(now / 1000 - 60), now)).toBe(60_000);
    expect(signInAgeMs(tok(now / 1000 - 3600), now)).toBeGreaterThan(RECENT_SIGN_IN_MS);
    expect(signInAgeMs({ headers: {} }, now)).toBe(Infinity);
  });
});
