import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const deleted = [];

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => db, adminBucket: async () => ({ file: (p) => ({ delete: async () => deleted.push(p) }), deleteFiles: async ({ prefix }) => deleted.push(`${prefix}*`) }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('../src/data/regions.js', () => ({ canonicalLandmarkId: (id) => (id === 'old-bell' ? 'bell' : id) }));

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
  it('files a tip under the place\'s current id when the check-in has an old one', async () => {
    db.docs['checkins/me_old-bell'] = checkin({ landmarkId: 'old-bell' });
    expect((await call({ checkinId: 'me_old-bell', text: 'Go early, quiet then.' })).body.tipId).toBe('me_bell');
    expect(db.docs['tips/me_bell'].landmarkId).toBe('bell');
  });
  it('a re-posted tip starts with no reports or marks from the deleted one', async () => {
    await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' });
    db.docs['tip_reports/me_bell_you'] = { uid: 'you', tipId: 'me_bell' };
    db.docs['tip_reactions/you_me_bell'] = { uid: 'you', tipId: 'me_bell', helpful: true };
    db.docs['tips/me_bell'].reportCount = 0;
    await call({ action: 'delete', landmarkId: 'bell' });
    expect(db.docs['tip_reports/me_bell_you']).toBeUndefined();
    expect(db.docs['tip_reactions/you_me_bell']).toBeUndefined();
  });
  it('a reported tip is withdrawn, not deleted: its reports stay and it waits for review', async () => {
    await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' });
    db.docs['tips/me_bell'].reportCount = 1;
    db.docs['tip_reports/me_bell_you'] = { uid: 'you', tipId: 'me_bell', at: NOW };
    expect((await call({ action: 'delete', landmarkId: 'bell', region: 'philly' })).body).toMatchObject({ ok: true, withdrawn: true });
    expect(db.docs['tips/me_bell'].status).toBe('withdrawn');
    expect(db.docs['tip_reports/me_bell_you']).toBeDefined();
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).body.code).toBe('withdrawn');
  });
  it('a held, unreported tip is deleted for good', async () => {
    await call({ checkinId: 'me_bell', text: 'the guards are sh1t here' });
    expect(db.docs['tips/me_bell'].status).toBe('held');
    expect((await call({ action: 'delete', landmarkId: 'bell' })).body).toEqual({ ok: true });
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('a removed tip blocks a new one at the place with its own message', async () => {
    db.docs['tips/me_bell'] = { authorUid: 'me', status: 'removed' };
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).body.code).toBe('removed');
  });
  it("keeps a photo another of your tips still shows", async () => {
    await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: photo() });
    db.docs['tips/me_other'] = { authorUid: 'me', photoPath: 'tip_photos/me/p1.jpg', status: 'live' };
    await call({ action: 'delete', landmarkId: 'bell' });
    expect(deleted).toEqual([]);
  });
  it("can't delete a tip a moderator removed", async () => {
    db.docs['tips/me_bell'] = { authorUid: 'me', status: 'removed' };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).code).toBe(403);
    expect(db.docs['tips/me_bell']).toBeDefined();
  });
  it('allows one tip per person per place', async () => {
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(200);
    db.docs['checkins/me_bell_2'] = checkin();
    const again = await call({ checkinId: 'me_bell_2', text: 'Second tip for the bell.' });
    expect(again.code).toBe(409);
    expect(db.docs['tips/me_bell'].text).toBe('Go early, quiet then.');
  });
  it('limits an account to 10 tips an hour, deleted tips included, across instances', async () => {
    db.docs['tip_post_log/me'] = { at: Array.from({ length: 10 }, () => NOW - 1000) };
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(429);
    db.docs['tip_post_log/me'] = { at: Array.from({ length: 10 }, () => NOW - 2 * 60 * 60 * 1000) };
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.' })).code).toBe(200);
    expect(db.docs['tip_post_log/me'].at).toHaveLength(1);
    await call({ action: 'delete', landmarkId: 'bell', region: 'philly' });
    expect(db.docs['tip_post_log/me'].at).toHaveLength(1);
  });
  it('refuses links from a first-week account and a third link from anyone', async () => {
    db.docs['users/me'].createdAt = ts(NOW - 2 * DAY);
    expect((await call({ checkinId: 'me_bell', text: 'Menu is at bellcafe.com today' })).body.code).toBe('links-new-account');
    db.docs['users/me'].createdAt = ts(NOW - 60 * DAY);
    expect((await call({ checkinId: 'me_bell', text: 'a.com b.com c.com all good' })).body.code).toBe('too-many-links');
    expect((await call({ checkinId: 'me_bell', text: 'Menu is at bellcafe.com today' })).code).toBe(200);
  });
  it('refuses any photo when the server has no bucket configured', async () => {
    delete process.env.VITE_FIREBASE_STORAGE_BUCKET;
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: photo() })).body.code).toBe('bad-photo');
  });
  it("refuses a photo that isn't a tip photo in your own folder of this app's bucket", async () => {
    expect((await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: 'https://firebasestorage.googleapis.com/v0/b/%E0/o/x' })).body.code).toBe('bad-photo');
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
  it('deletes your own tip, its marks, views and photo, by its current id', async () => {
    await call({ checkinId: 'me_bell', text: 'Go early, quiet then.', photoURL: photo() });
    db.docs['tip_reactions/you_me_bell'] = { uid: 'you', tipId: 'me_bell', helpful: true };
    db.docs['tip_views/you_me_bell'] = { uid: 'you', tipId: 'me_bell' };
    const { code } = await call({ action: 'delete', landmarkId: 'old-bell', region: 'philly' });
    expect(code).toBe(200);
    expect(db.docs['tips/me_bell']).toBeUndefined();
    expect(db.docs['tip_reactions/you_me_bell']).toBeUndefined();
    expect(db.docs['tip_views/you_me_bell']).toBeUndefined();
    expect(deleted).toEqual(['tip_photos/me/p1.jpg']);
  });
  it("can't delete someone else's tip", async () => {
    db.docs['tips/you_bell'] = { authorUid: 'you', status: 'live' };
    caller = { uid: 'me', emailVerified: true };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).code).toBe(404);
    expect(db.docs['tips/you_bell']).toBeDefined();
  });
  it('account deletion removes every tip, mark and view of yours and fixes the counts, even unverified', async () => {
    caller = { uid: 'me', emailVerified: false };
    db.docs['tips/me_a'] = { authorUid: 'me', status: 'removed' };
    db.docs['tips/me_b'] = { authorUid: 'me', status: 'live', photoPath: 'tip_photos/me/b.jpg' };
    db.docs['tips/you_x'] = { authorUid: 'you', status: 'live', counts: { helpful: 3, saved: 2 } };
    db.docs['tip_reactions/me_you_x'] = { uid: 'me', tipId: 'you_x', helpful: true, saved: true };
    db.docs['tip_views/me_you_x'] = { uid: 'me', tipId: 'you_x' };
    db.docs['tip_views/you_me_b'] = { uid: 'you', tipId: 'me_b', authorUid: 'me' };
    db.docs['tip_reports/you_x_me'] = { uid: 'me', tipId: 'you_x', reason: 'spam' };
    db.docs['tip_reports/me_c_zed'] = { uid: 'zed', tipId: 'me_c', authorUid: 'me' };
    db.docs['tips/you_y'] = { authorUid: 'you', status: 'live', counts: { helpful: 0, saved: 0 }, createdAtMs: NOW };
    db.docs['tip_reactions/me_you_y'] = { uid: 'me', tipId: 'you_y', helpful: true, firstAt: NOW - DAY };
    const { code, body } = await call({ action: 'delete-mine' });
    expect(code).toBe(200);
    expect(body).toMatchObject({ tips: 2, reactions: 2 });
    expect(Object.keys(db.docs).filter((k) => k.startsWith('tips/me_') || k.startsWith('tip_reactions/me_') || k.startsWith('tip_views/'))).toEqual([]);
    expect(db.docs['tip_reports/you_x_me']).toBeUndefined();
    expect(db.docs['tip_reports/me_c_zed']).toBeUndefined();
    expect(db.docs['tips/you_y'].counts.helpful).toBe(0);
    expect(deleted).toContain('tip_photos/me/*');
    expect(db.docs['tips/you_x'].counts).toEqual({ helpful: 2, saved: 1 });
    expect(deleted).toContain('tip_photos/me/b.jpg');
  });
});
