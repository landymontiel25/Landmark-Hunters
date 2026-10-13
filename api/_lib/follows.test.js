import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { follow, unfollow, removeFollowsBetween, deleteMyFollows, followUpkeep, FOLLOW_RATE_LIMIT } = await import('./follows.js');

const base = () =>
  fakeDb({
    'users/me': { uid: 'me' },
    'users/pub': { uid: 'pub', public: true },
    'users/priv': { uid: 'priv', public: false },
    'users/blocker': { uid: 'blocker', public: true },
    'blocks/blocker_me': { blockerUid: 'blocker', blockedUid: 'me' },
  });

describe('follow', () => {
  it('follows a public profile once and counts it on both sides', async () => {
    const db = base();
    expect(await follow(db, 'me', 'pub')).toEqual([200, { ok: true, following: true }, { created: true, followerCount: 1 }]);
    expect(await follow(db, 'me', 'pub')).toEqual([200, { ok: true, following: true }]);
    expect(db.docs['follows/me_pub']).toMatchObject({ followerUid: 'me', followeeUid: 'pub' });
    expect(db.docs['users/pub'].followerCount).toBe(1);
    expect(db.docs['users/me'].followingCount).toBe(1);
  });
  it('refuses yourself, a private profile, a missing account and a block either way', async () => {
    const db = base();
    expect((await follow(db, 'me', 'me'))[1].code).toBe('self');
    expect((await follow(db, 'me', 'priv'))[1].code).toBe('private');
    expect((await follow(db, 'me', 'ghost'))[1].code).toBe('unavailable');
    expect((await follow(db, 'me', 'blocker'))[1].code).toBe('unavailable');
    expect(Object.keys(db.docs).some((k) => k.startsWith('follows/'))).toBe(false);
  });
  it(`stops at ${FOLLOW_RATE_LIMIT} new follows an hour`, async () => {
    const db = base();
    const now = 1e12;
    db.docs['follow_log/me'] = { at: Array.from({ length: FOLLOW_RATE_LIMIT }, () => now - 1000) };
    expect((await follow(db, 'me', 'pub', { nowMs: now }))[1].code).toBe('rate');
    expect((await follow(db, 'me', 'pub', { nowMs: now + 60 * 60 * 1000 }))[0]).toBe(200);
  });
});

describe('unfollow, blocks and account deletion', () => {
  it('unfollow removes the follow and never takes a count below 0', async () => {
    const db = base();
    await follow(db, 'me', 'pub');
    db.docs['users/pub'].followerCount = 0;
    await unfollow(db, 'me', 'pub');
    expect(db.docs['follows/me_pub']).toBeUndefined();
    expect(db.docs['users/pub'].followerCount).toBe(0);
    expect(db.docs['users/me'].followingCount).toBe(0);
  });
  it('a block removes follows both ways', async () => {
    const db = base();
    db.docs['users/me'].public = true;
    await follow(db, 'me', 'pub');
    await follow(db, 'pub', 'me');
    await removeFollowsBetween(db, 'pub', 'me');
    expect(db.docs['follows/me_pub']).toBeUndefined();
    expect(db.docs['follows/pub_me']).toBeUndefined();
    expect(db.docs['users/pub']).toMatchObject({ followerCount: 0, followingCount: 0 });
  });
  it('account deletion removes every follow from and to the account and fixes the other side', async () => {
    const db = base();
    db.docs['users/me'].public = true;
    await follow(db, 'me', 'pub');
    await follow(db, 'pub', 'me');
    expect(await deleteMyFollows(db, 'me')).toBe(2);
    expect(db.docs['users/pub']).toMatchObject({ followerCount: 0, followingCount: 0 });
  });
});

describe('followUpkeep', () => {
  it('removes follows across a block or from a deleted account and resets wrong counts from the follows', async () => {
    const db = fakeDb({
      'users/a': { public: true, followerCount: 99, followingCount: 0 },
      'users/b': { public: true, followerCount: 0, followingCount: 0 },
      'users/c': { public: true },
      'follows/b_a': { followerUid: 'b', followeeUid: 'a' },
      'follows/c_a': { followerUid: 'c', followeeUid: 'a' },
      'blocks/a_c': { blockerUid: 'a', blockedUid: 'c' },
      'follows/ghost_a': { followerUid: 'ghost', followeeUid: 'a' },
    });
    const out = await followUpkeep(db);
    expect(out.unblocked).toBe(1);
    expect(out.orphans).toBe(1);
    expect(db.docs['follows/ghost_a']).toBeUndefined();
    expect(db.docs['follows/c_a']).toBeUndefined();
    expect(db.docs['users/a'].followerCount).toBe(1);
    expect(db.docs['users/b'].followingCount).toBe(1);
    expect(db.docs['users/c'].followingCount || 0).toBe(0);
  });
});
