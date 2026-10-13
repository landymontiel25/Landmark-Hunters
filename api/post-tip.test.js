import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const deleted = [];

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => db, adminBucket: async () => ({ file: (p) => ({ delete: async () => deleted.push(p) }) }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));

const { default: handler } = await import('./post-tip.js');

const call = async (body) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};
const ts = (ms) => ({ toMillis: () => ms });
const checkin = (o = {}) => ({ userId: 'me', landmarkId: 'bell', landmarkName: 'Liberty Bell', region: 'philly', visited: true, createdAt: ts(NOW - DAY), presence: { verified: true }, ...o });
const BUCKET = 'demo.appspot.com';
const photo = (uid = 'me', name = 'p1.jpg') => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`tip_photos/${uid}/${name}`)}?alt=media&token=t`;

beforeEach(() => {
  process.env.VITE_FIREBASE_STORAGE_BUCKET = BUCKET;
  caller = { uid: 'me', emailVerified: true };
  deleted.length = 0;
  db = fakeDb({
    'checkins/me_bell': checkin(),
    'users/me': { username: 'landy', createdAt: ts(NOW - 60 * DAY) },
  });
});

describe('api/post-tip: posting', () => {
  it('saves a live tip on a verified check-in, with the place taken from the check-in', async () => {
    const { code, body } = await call({ checkinId: 'me_bell', text: '  Go early,   the line wraps the block. ', tags: ['go-early'], photoURL: photo() });
    expect(code).toBe(200);
    expect(body).toEqual({ ok: true, tipId: 'me_bell', status: 'live' });
    const t = db.docs['tips/me_bell'];
    expect(t).toMatchObject({ authorUid: 'me', authorName: 'landy', landmarkId: 'bell', region: 'philly', checkinId: 'me_bell', text: 'Go early, the line wraps the block.', tags: ['go-early'], status: 'live', hidden: false, reportCount: 0, counts: { helpful: 0, saved: 0 }, verified: true, photoPath: 'tip_photos/me/p1.jpg' });
    expect(t.visitAt).toBe(NOW - DAY);
  });
  it('holds a tip the word filter flags', async () => {
    const { body } = await call({ checkinId: 'me_bell', text: 'the guards here are sh1t and rude' });
    expect(body.status).toBe('held');
    expect(db.docs['tips/me_bell']).toMatchObject({ status: 'held', heldReasons: ['profanity'] });
  });
  it('needs a verified email, a sign-in and a verified, recent check-in of your own', async () => {
    caller = { uid: 'me', emailVerified: false };
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(403);
    caller = null;
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(401);
    caller = { uid: 'me', emailVerified: true };
    db.docs['checkins/me_bell'] = checkin({ presence: { verified: false, reason: 'too-far' } });
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).body.code).toBe('not-verified');
    db.docs['checkins/me_bell'] = checkin({ createdAt: ts(NOW - 31 * DAY) });
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).body.code).toBe('too-old');
    db.docs['checkins/you_bell'] = checkin({ userId: 'you' });
    expect((await call({ checkinId: 'you_bell', text: 'Go early, quiet then.' })).code).toBe(403);
    expect((await call({ checkinId: 'me_none', text: 'Go early, quiet then.' })).body.code).toBe('no-checkin');
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('allows one tip per person per place', async () => {
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(200);
    db.docs['checkins/me_bell_2'] = checkin();
    const again = await call({ checkinId: 'me_bell_2', text: 'Second tip for the bell.' });
    expect(again.code).toBe(409);
    expect(db.docs['tips/me_bell'].text).toBe('Go early, quiet then.');
  });
  it('limits an account to 10 tips an hour, counted from its own tips', async () => {
    for (let i = 0; i < 10; i++) db.docs[`tips/me_p${i}`] = { authorUid: 'me', createdAtMs: NOW - 1000 };
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(429);
    for (let i = 0; i < 10; i++) db.docs[`tips/me_p${i}`].createdAtMs = NOW - 2 * 60 * 60 * 1000;
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(200);
  });
  it('refuses links from a first-week account and a third link from anyone', async () => {
    db.docs['users/me'].createdAt = ts(NOW - 2 * DAY);
    expect((await call({ checkinId: 'me_bell', text: 'Menu is at bellcafe.com today' })).body.code).toBe('links-new-account');
    db.docs['users/me'].createdAt = ts(NOW - 60 * DAY);
    expect((await call({ checkinId: 'me_bell', text: 'a.com b.com c.com all good' })).body.code).toBe('too-many-links');
    expect((await call({ checkinId: 'me_bell', text: 'Menu is at bellcafe.com today' })).code).toBe(200);
  });
  it("refuses a photo that isn't a tip photo in your own folder of this app's bucket", async () => {
    for (const url of [photo('you'), photo('me', 'p.png'), 'https://evil.com/x.jpg', photo().replace(BUCKET, 'other.appspot.com'), `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('review_photos/me/me.jpg')}`]) {
      expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: url })).body.code).toBe('bad-photo');
    }
  });
  it('refuses bad input', async () => {
    expect((await call({ checkinId: '../x', text: 'Go early, quiet then.' })).code).toBe(400);
    expect((await call({ checkinId: 'me_bell' })).code).toBe(400);
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', tags: ['nope'] })).body.code).toBe('bad-tags');
    expect((await call({ action: 'hack', checkinId: 'me_bell' })).code).toBe(400);
  });
});

describe('api/post-tip: deleting', () => {
  it('deletes your own tip, its marks and its photo', async () => {
    await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: photo() });
    db.docs['tip_reactions/you_me_bell'] = { uid: 'you', tipId: 'me_bell', helpful: true };
    const { code } = await call({ action: 'delete', landmarkId: 'bell' });
    expect(code).toBe(200);
    expect(db.docs['tips/me_bell']).toBeUndefined();
    expect(db.docs['tip_reactions/you_me_bell']).toBeUndefined();
    expect(deleted).toEqual(['tip_photos/me/p1.jpg']);
  });
  it("can't delete someone else's tip or a tip a moderator removed", async () => {
    db.docs['tips/you_bell'] = { authorUid: 'you', status: 'live' };
    caller = { uid: 'me', emailVerified: true };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).code).toBe(404);
    db.docs['tips/me_bell'] = { authorUid: 'me', status: 'removed' };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).code).toBe(403);
    expect(db.docs['tips/me_bell']).toBeDefined();
  });
  it('account deletion removes every tip, mark and view of yours and fixes the counts, even unverified', async () => {
    caller = { uid: 'me', emailVerified: false };
    db.docs['tips/me_a'] = { authorUid: 'me', status: 'removed' };
    db.docs['tips/me_b'] = { authorUid: 'me', status: 'live', photoPath: 'tip_photos/me/b.jpg' };
    db.docs['tips/you_x'] = { authorUid: 'you', status: 'live', counts: { helpful: 3, saved: 2 } };
    db.docs['tip_reactions/me_you_x'] = { uid: 'me', tipId: 'you_x', helpful: true, saved: true };
    db.docs['tip_views/me_you_x'] = { uid: 'me', tipId: 'you_x' };
    const { code, body } = await call({ action: 'delete-mine' });
    expect(code).toBe(200);
    expect(body).toMatchObject({ tips: 2, reactions: 1 });
    expect(Object.keys(db.docs).filter((k) => k.startsWith('tips/me_') || k.startsWith('tip_reactions/me_') || k.startsWith('tip_views/me_'))).toEqual([]);
    expect(db.docs['tips/you_x'].counts).toEqual({ helpful: 2, saved: 1 });
    expect(deleted).toEqual(['tip_photos/me/b.jpg']);
  });
});
