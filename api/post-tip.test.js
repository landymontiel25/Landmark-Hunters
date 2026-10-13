import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;
let uploaded;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const deleted = [];

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({
  adminDb: () => db,
  adminBucket: async () => ({
    file: (p) => ({ delete: async () => deleted.push(p), exists: async () => [uploaded.has(p)] }),
    getFiles: async ({ prefix }) => [[...uploaded].filter((p) => p.startsWith(prefix)).map((name) => ({ name, delete: async () => deleted.push(name) }))],
  }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('../src/data/regions.js', () => ({ canonicalRegionId: (r) => r, canonicalLandmarkId: (id) => (id === 'old-bell' ? 'bell' : id) }));

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
const post = (o = {}) => call({ checkinId: 'me_bell', text: 'Go early, quiet then.', ...o });

beforeEach(() => {
  process.env.VITE_FIREBASE_STORAGE_BUCKET = BUCKET;
  caller = { uid: 'me', emailVerified: true };
  uploaded = new Set(['tip_photos/me/p1.jpg', 'tip_photos/me/p2.jpg']);
  deleted.length = 0;
  db = fakeDb({ 'checkins/me_bell': checkin(), 'users/me': { username: 'landy', createdAt: ts(NOW - 60 * DAY) } });
});

describe('api/post-tip: posting', () => {
  it('saves a live tip on a verified check-in, with the place taken from the check-in', async () => {
    const { code, body } = await post({ text: '  Go early,   the line wraps the block. ', tags: ['go-early'], photoURL: photo() });
    expect(code).toBe(200);
    expect(body).toEqual({ ok: true, tipId: 'me_bell', status: 'live' });
    const t = db.docs['tips/me_bell'];
    expect(t.checkinId).toBeUndefined();
    expect(t).toMatchObject({ authorUid: 'me', authorName: 'landy', landmarkId: 'bell', region: 'philly', text: 'Go early, the line wraps the block.', tags: ['go-early'], status: 'live', hidden: false, reportCount: 0, counts: { helpful: 0, saved: 0 }, verified: true, photoPath: 'tip_photos/me/p1.jpg', visitMonth: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(new Date(NOW - DAY)).slice(0, 7) });
    expect(t.visitAt).toBeUndefined();
    expect(typeof t.gen).toBe('string');
    expect(db.docs['tip_photo_claims/tip_photos__me__p1.jpg']).toMatchObject({ uid: 'me', tipId: 'me_bell' });
  });
  it('files a tip under the place\'s current id when the check-in has an old one', async () => {
    db.docs['checkins/me_old-bell'] = checkin({ landmarkId: 'old-bell' });
    expect((await post({ checkinId: 'me_old-bell' })).body.tipId).toBe('me_bell');
    expect(db.docs['tips/me_bell'].landmarkId).toBe('bell');
  });
  it('holds a tip the word filter flags', async () => {
    expect((await post({ text: 'the guards here are sh1t and rude' })).body.status).toBe('held');
    expect(db.docs['tips/me_bell']).toMatchObject({ status: 'held', heldReasons: ['profanity'] });
  });
  it('needs a verified email, a sign-in and a verified, recent check-in of your own', async () => {
    caller = { uid: 'me', emailVerified: false };
    expect((await post()).code).toBe(403);
    caller = null;
    expect((await post()).code).toBe(401);
    caller = { uid: 'me', emailVerified: true };
    db.docs['checkins/me_bell'] = checkin({ presence: { verified: false, reason: 'too-far' } });
    expect((await post()).body.code).toBe('not-verified');
    db.docs['checkins/me_bell'] = checkin({ createdAt: ts(NOW - 31 * DAY) });
    expect((await post()).body.code).toBe('too-old');
    db.docs['checkins/you_bell'] = checkin({ userId: 'you' });
    expect((await post({ checkinId: 'you_bell' })).code).toBe(403);
    expect((await post({ checkinId: 'me_none' })).body.code).toBe('no-checkin');
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('allows one tip per person per place, with a message for each case', async () => {
    expect((await post()).code).toBe(200);
    db.docs['checkins/me_bell_2'] = checkin();
    expect((await post({ checkinId: 'me_bell_2', text: 'Second tip for the bell.' })).body.code).toBe('exists');
    db.docs['tips/me_bell'].status = 'withdrawn';
    expect((await post()).body.code).toBe('withdrawn');
    db.docs['tips/me_bell'].status = 'removed';
    expect((await post()).body.code).toBe('removed');
  });
  it('limits an account to 10 tips an hour, deleted tips included', async () => {
    db.docs['tip_post_log/me'] = { at: Array.from({ length: 10 }, () => NOW - 1000) };
    expect((await post()).code).toBe(429);
    db.docs['tip_post_log/me'] = { at: Array.from({ length: 10 }, () => NOW - 2 * 60 * 60 * 1000) };
    expect((await post()).code).toBe(200);
    expect(db.docs['tip_post_log/me'].at).toHaveLength(1);
    await call({ action: 'delete', landmarkId: 'bell', region: 'philly' });
    expect(db.docs['tip_post_log/me'].at).toHaveLength(1);
  });
  it('refuses links from a first-week account and a third link from anyone', async () => {
    db.docs['users/me'].createdAt = ts(NOW - 2 * DAY);
    expect((await post({ text: 'Menu is at bellcafe.com today' })).body.code).toBe('links-new-account');
    db.docs['users/me'].createdAt = ts(NOW - 60 * DAY);
    expect((await post({ text: 'a.com b.com c.com all good' })).body.code).toBe('too-many-links');
    expect((await post({ text: 'Menu is at bellcafe.com today' })).code).toBe(200);
  });
  it('photos: an uploaded file in your own folder of this bucket, used on one tip only', async () => {
    for (const url of [photo('you'), photo('me', 'p.png'), 'https://evil.com/x.jpg', photo().replace(BUCKET, 'other.appspot.com'), 'https://firebasestorage.googleapis.com/v0/b/%E0/o/x', photo('me', 'later.jpg')]) {
      expect((await post({ photoURL: url })).body.code).toBe('bad-photo');
    }
    db.docs['tip_photo_claims/tip_photos__me__p1.jpg'] = { uid: 'me', tipId: 'me_other' };
    expect((await post({ photoURL: photo() })).body.code).toBe('photo-used');
    delete process.env.VITE_FIREBASE_STORAGE_BUCKET;
    expect((await post({ photoURL: photo('me', 'p2.jpg') })).body.code).toBe('bad-photo');
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('keeps the visit month in the place\'s own time zone', async () => {
    // 9 pm on Oct 31 in Philadelphia is Nov 1 in UTC.
    db.docs['checkins/me_bell'] = checkin({ createdAt: ts(Date.UTC(2026, 10, 1, 1, 0)) });
    const realNow = Date.now;
    Date.now = () => Date.UTC(2026, 10, 2);
    await post();
    Date.now = realNow;
    expect(db.docs['tips/me_bell'].visitMonth).toBe('2026-10');
  });
  it('refuses a check-in with no region', async () => {
    db.docs['checkins/me_bell'] = checkin({ region: null });
    expect((await post()).body.code).toBe('no-place');
  });
  it('refuses bad input', async () => {
    expect((await post({ checkinId: '../x' })).code).toBe(400);
    expect((await call({ checkinId: 'me_bell' })).code).toBe(400);
    expect((await post({ tags: ['nope'] })).body.code).toBe('bad-tags');
    expect((await call({ action: 'hack' })).code).toBe(400);
  });
});

describe('api/post-tip: deleting', () => {
  it('deletes your own tip with its marks, views and photo, by its current id', async () => {
    await post({ photoURL: photo() });
    const gen = db.docs['tips/me_bell'].gen;
    db.docs['tip_reactions/you_me_bell'] = { uid: 'you', tipId: 'me_bell', gen, helpful: true };
    db.docs['tip_views/you_me_bell'] = { uid: 'you', tipId: 'me_bell', gen };
    expect((await call({ action: 'delete', landmarkId: 'old-bell', region: 'philly' })).body).toEqual({ ok: true });
    expect(db.docs['tips/me_bell']).toBeUndefined();
    expect(db.docs['tip_reactions/you_me_bell']).toBeUndefined();
    expect(db.docs['tip_views/you_me_bell']).toBeUndefined();
    expect(deleted).toEqual(['tip_photos/me/p1.jpg']);
  });
  it('cleanup leaves what belongs to a newer post at the same id', async () => {
    await post();
    db.docs['tip_reactions/zed_me_bell'] = { uid: 'zed', tipId: 'me_bell', gen: 'newer-post', helpful: true };
    await call({ action: 'delete', landmarkId: 'bell' });
    expect(db.docs['tip_reactions/zed_me_bell']).toBeDefined();
  });
  it('a tip with one report is still deleted normally', async () => {
    await post();
    db.docs['tips/me_bell'].reportCount = 1;
    expect((await call({ action: 'delete', landmarkId: 'bell' })).body).toEqual({ ok: true });
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('a tip hidden by reports is withdrawn, not deleted: its reports stay and it waits for review', async () => {
    await post();
    db.docs['tips/me_bell'].reportCount = 2;
    db.docs['tips/me_bell'].hidden = true;
    db.docs['tip_reports/me_bell_you'] = { uid: 'you', tipId: 'me_bell', gen: db.docs['tips/me_bell'].gen };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).body).toEqual({ ok: true, withdrawn: true });
    expect(db.docs['tips/me_bell']).toMatchObject({ status: 'withdrawn', text: 'Go early, quiet then.' });
    expect(db.docs['tip_reports/me_bell_you']).toBeDefined();
    expect((await post()).body.code).toBe('withdrawn');
  });
  it('a held, unreported tip is deleted for good', async () => {
    await post({ text: 'the guards are sh1t here' });
    expect((await call({ action: 'delete', landmarkId: 'bell' })).body).toEqual({ ok: true });
    expect(db.docs['tips/me_bell']).toBeUndefined();
  });
  it('a delete from another region\'s page never touches your tip here', async () => {
    await post();
    expect((await call({ action: 'delete', landmarkId: 'bell', region: 'miami' })).code).toBe(404);
    expect(db.docs['tips/me_bell']).toBeDefined();
  });
  it("can't delete someone else's tip or one a moderator removed", async () => {
    db.docs['tips/you_bell'] = { authorUid: 'you', status: 'live' };
    caller = { uid: 'you', emailVerified: true };
    caller = { uid: 'me', emailVerified: true };
    db.docs['tips/me_x'] = { authorUid: 'you', status: 'live' };
    expect((await call({ action: 'delete', landmarkId: 'x' })).code).toBe(404);
    db.docs['tips/me_bell'] = { authorUid: 'me', status: 'removed' };
    expect((await call({ action: 'delete', landmarkId: 'bell' })).code).toBe(403);
    expect(db.docs['tips/me_bell']).toBeDefined();
  });
});

describe('api/post-tip: account deletion', () => {
  it('retires every tip like a delete, keeps reported or removed ones (and their photos) for review, fixes counts', async () => {
    caller = { uid: 'me', emailVerified: false };
    uploaded = new Set(['tip_photos/me/a.jpg', 'tip_photos/me/b.jpg', 'tip_photos/me/orphan.jpg']);
    db.docs['tips/me_a'] = { authorUid: 'me', status: 'removed', text: 'awful words', photoPath: 'tip_photos/me/a.jpg', reportCount: 2, gen: 'g1' };
    db.docs['tips/me_r'] = { authorUid: 'me', status: 'live', text: 'reported twice', reportCount: 2, hidden: true, gen: 'g2' };
    db.docs['tips/me_b'] = { authorUid: 'me', status: 'live', photoPath: 'tip_photos/me/b.jpg', gen: 'g3' };
    db.docs['tips/you_x'] = { authorUid: 'you', status: 'live', counts: { helpful: 3, saved: 2 }, gen: 'gx' };
    db.docs['tips/you_y'] = { authorUid: 'you', status: 'live', counts: { helpful: 0, saved: 0 }, gen: 'gy-new' };
    db.docs['tip_reactions/me_you_x'] = { uid: 'me', tipId: 'you_x', gen: 'gx', helpful: true, saved: true };
    db.docs['tip_reactions/me_you_y'] = { uid: 'me', tipId: 'you_y', gen: 'gy-old', helpful: true };
    db.docs['tip_views/me_you_x'] = { uid: 'me', tipId: 'you_x', gen: 'gx' };
    db.docs['tip_views/you_me_b'] = { uid: 'you', tipId: 'me_b', authorUid: 'me', gen: 'g3' };
    db.docs['tip_photo_claims/tip_photos__me__b.jpg'] = { uid: 'me', tipId: 'me_b', path: 'tip_photos/me/b.jpg' };
    db.docs['tip_photo_claims/tip_photos__me__a.jpg'] = { uid: 'me', tipId: 'me_a', path: 'tip_photos/me/a.jpg' };
    db.docs['tip_reports/you_x_me'] = { uid: 'me', tipId: 'you_x', reason: 'spam', gen: 'gx' };
    db.docs['tip_post_log/me'] = { at: [NOW] };
    const { code, body } = await call({ action: 'delete-mine' });
    expect(code).toBe(200);
    expect(body).toMatchObject({ tips: 3, reactions: 2 });
    expect(db.docs['tips/me_a']).toMatchObject({ status: 'removed', text: 'awful words', authorName: 'Deleted account' });
    expect(db.docs['tips/me_r']).toMatchObject({ status: 'withdrawn', text: 'reported twice' });
    expect(db.docs['tips/me_b']).toBeUndefined();
    expect(db.docs['tips/you_x'].counts).toEqual({ helpful: 2, saved: 1 });
    expect(db.docs['tips/you_y'].counts.helpful).toBe(0);
    expect(Object.keys(db.docs).filter((k) => k.startsWith('tip_reactions/') || k.startsWith('tip_views/'))).toEqual([]);
    expect(db.docs['tip_photo_claims/tip_photos__me__a.jpg']).toBeDefined();
    expect(db.docs['tip_photo_claims/tip_photos__me__b.jpg']).toBeUndefined();
    expect(deleted.sort()).toEqual(['tip_photos/me/b.jpg', 'tip_photos/me/orphan.jpg']);
    // Kept so a live account can't use this to report twice or post past the limit.
    expect(db.docs['tip_reports/you_x_me']).toBeDefined();
    expect(db.docs['tip_post_log/me']).toBeDefined();
  });
});

describe('api/post-tip: discarding an unposted photo', () => {
  it('deletes your own unclaimed upload, never one on a tip or someone else\'s', async () => {
    expect((await call({ action: 'discard-photo', photoURL: photo('me', 'p2.jpg') })).code).toBe(200);
    expect(deleted).toEqual(['tip_photos/me/p2.jpg']);
    db.docs['tip_photo_claims/tip_photos__me__p1.jpg'] = { uid: 'me', tipId: 'me_bell', path: 'tip_photos/me/p1.jpg' };
    expect((await call({ action: 'discard-photo', photoURL: photo() })).code).toBe(409);
    expect((await call({ action: 'discard-photo', photoURL: photo('you') })).code).toBe(400);
    expect(deleted).toEqual(['tip_photos/me/p2.jpg']);
    // A discarded photo can't then go on a tip.
    expect((await post({ photoURL: photo('me', 'p2.jpg') })).body.code).toBe('photo-used');
  });
  it('account deletion leaves photos and claims alone when a tip failed to retire', async () => {
    uploaded = new Set(['tip_photos/me/a.jpg']);
    db.docs['tips/me_a'] = { authorUid: 'me', status: 'live', photoPath: 'tip_photos/me/a.jpg', reportCount: 2, hidden: true, gen: 'g1' };
    db.docs['tip_photo_claims/tip_photos__me__a.jpg'] = { uid: 'me', tipId: 'me_a', path: 'tip_photos/me/a.jpg' };
    const real = db.runTransaction;
    db.runTransaction = async () => {
      throw new Error('contention');
    };
    expect((await call({ action: 'delete-mine' })).code).toBe(500);
    db.runTransaction = real;
    expect(deleted).toEqual([]);
    expect(db.docs['tip_photo_claims/tip_photos__me__a.jpg']).toBeDefined();
  });
});
