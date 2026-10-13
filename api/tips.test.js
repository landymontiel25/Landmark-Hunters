import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => db, adminBucket: async () => null }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('../src/data/regions.js', () => ({ canonicalRegionId: (r) => (r === 'coralgables' ? 'miami' : r), canonicalLandmarkId: (id) => (id === 'old-bell' ? 'bell' : id) }));

const { default: handler, reportTip } = await import('./tips.js');

const call = async (method, { query = {}, body = {} } = {}) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method, headers: {}, query, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};
const tip = (authorUid, o = {}) => ({ authorUid, authorName: authorUid, landmarkId: 'bell', region: 'philly', text: `Tip from ${authorUid}.`, tags: [], status: 'live', hidden: false, reportCount: 0, counts: { helpful: 0, saved: 0 }, verified: true, createdAtMs: 1, visitMonth: '2027-01', gen: `g-${authorUid}`, heldReasons: ['x'], ...o });
const list = (landmarkId = 'bell') => call('GET', { query: { region: 'philly', landmarkId } });
const react = (tipId, kind, on) => call('POST', { body: { action: 'react', tipId, kind, on } });
const report = (tipId = 'ann_bell', reason = 'offensive') => call('POST', { body: { action: 'report', tipId, reason } });

beforeEach(() => {
  caller = { uid: 'me', emailVerified: true };
  db = fakeDb({
    'tips/ann_bell': tip('ann', { createdAtMs: 3 }),
    'tips/bob_bell': tip('bob', { createdAtMs: 2 }),
    'tips/cat_bell': tip('cat', { status: 'held' }),
    'tips/dan_bell': tip('dan', { hidden: true, reportCount: 2 }),
    'tips/eve_bell': tip('eve', { region: 'miami' }),
    'tips/me_bell': tip('me', { status: 'held' }),
    'tips/fay_bell': tip('fay'),
    'tips/gus_bell': tip('gus'),
    'blocks/me_fay': { blockerUid: 'me', blockedUid: 'fay' },
    'blocks/gus_me': { blockerUid: 'gus', blockedUid: 'me' },
  });
});

describe('api/tips: reading', () => {
  it('returns your own tip first with its status, then live tips newest first', async () => {
    const { code, body } = await list();
    expect(code).toBe(200);
    expect(body.tips.map((t) => t.id)).toEqual(['me_bell', 'ann_bell', 'bob_bell']);
    expect(body.tips[0]).toMatchObject({ mine: true, status: 'held', hidden: false });
    expect(body.tips[1].status).toBeUndefined();
  });
  it('hides tips across a block both ways, held, hidden and other-region tips', async () => {
    const ids = (await list()).body.tips.map((t) => t.id);
    for (const hidden of ['cat_bell', 'dan_bell', 'eve_bell', 'fay_bell', 'gus_bell']) expect(ids).not.toContain(hidden);
  });
  it('never returns reporters, held reasons, gens or who marked a tip', async () => {
    const t = (await list()).body.tips.find((x) => !x.mine);
    expect(Object.keys(t).sort()).toEqual(['authorName', 'authorUid', 'counts', 'id', 'landmarkId', 'mine', 'photoURL', 'region', 'tags', 'text', 'verified', 'visitMonth'].sort());
  });
  it('gives the month of the visit, never the day or time', async () => {
    expect((await list()).body.tips.find((x) => x.id === 'ann_bell').visitMonth).toBe('2027-01');
  });
  it('always returns your own tip, even behind 50 newer ones', async () => {
    for (let i = 0; i < 60; i++) db.docs[`tips/u${i}_bell`] = tip(`u${i}`, { createdAtMs: 1000 + i });
    const ids = (await list()).body.tips.map((t) => t.id);
    expect(ids[0]).toBe('me_bell');
    expect(ids).toHaveLength(51);
  });
  it("records which of others' live tips you saw; a reload writes nothing; an older post's view doesn't carry over", async () => {
    await list();
    expect(db.docs['tip_views/me_ann_bell']).toMatchObject({ uid: 'me', tipId: 'ann_bell', authorUid: 'ann', gen: 'g-ann' });
    expect(db.docs['tip_views/me_me_bell']).toBeUndefined();
    const before = db.writes.length;
    await list();
    expect(db.writes.length).toBe(before);
    db.docs['tip_views/me_ann_bell'] = { ...db.docs['tip_views/me_ann_bell'], gen: 'g-old', firstAt: 5 };
    await list();
    expect(db.docs['tip_views/me_ann_bell'].firstAt).not.toBe(5);
    expect(db.docs['tip_views/me_ann_bell'].gen).toBe('g-ann');
  });
  it('finds tips under a renamed place by its current id', async () => {
    expect((await list('old-bell')).body.tips.map((t) => t.id)).toContain('ann_bell');
  });
  it("an unverified account's views aren't recorded", async () => {
    caller = { uid: 'me', emailVerified: false };
    expect((await list()).code).toBe(200);
    expect(Object.keys(db.docs).filter((k) => k.startsWith('tip_views/'))).toEqual([]);
  });
  it("ids '.', '..' and reserved names are refused with a 400", async () => {
    for (const tipId of ['.', '..', '__x__']) expect((await call('POST', { body: { action: 'report', tipId, reason: 'spam' } })).code).toBe(400);
    expect((await call('GET', { query: { region: 'philly', landmarkId: '..' } })).code).toBe(400);
  });
  it('needs a sign-in and a place', async () => {
    expect((await call('GET', { query: { region: 'philly' } })).code).toBe(400);
    caller = null;
    expect((await list()).code).toBe(401);
  });
});

describe('api/tips: helpful, saved and reports', () => {
  it('marks a tip helpful and saved, counting each person once, and unmarks', async () => {
    expect((await react('ann_bell', 'helpful', true)).code).toBe(200);
    await react('ann_bell', 'helpful', true);
    await react('ann_bell', 'saved', true);
    expect(db.docs['tips/ann_bell'].counts).toEqual({ helpful: 1, saved: 1 });
    expect(db.docs['tip_reactions/me_ann_bell']).toMatchObject({ uid: 'me', tipId: 'ann_bell', gen: 'g-ann', helpful: true, saved: true });
    expect((await list()).body.reactions).toEqual({ ann_bell: { helpful: true, saved: true } });
    await react('ann_bell', 'helpful', false);
    await react('ann_bell', 'saved', false);
    expect(db.docs['tips/ann_bell'].counts).toEqual({ helpful: 0, saved: 0 });
    expect(db.docs['tip_reactions/me_ann_bell']).toBeUndefined();
  });
  it('ignores marks and reports from an older post at the same id', async () => {
    db.docs['tip_reactions/me_ann_bell'] = { uid: 'me', tipId: 'ann_bell', gen: 'g-old', helpful: true, saved: false };
    db.docs['tip_reports/ann_bell_g-old_me'] = { uid: 'me', tipId: 'ann_bell', gen: 'g-old' };
    expect((await list()).body.reactions).toEqual({});
    await react('ann_bell', 'helpful', true);
    expect(db.docs['tips/ann_bell'].counts.helpful).toBe(1);
    await report();
    expect(db.docs['tips/ann_bell'].reportCount).toBe(1);
  });
  it('takes back a mark on a tip that has since been hidden', async () => {
    await react('ann_bell', 'saved', true);
    db.docs['tips/ann_bell'].hidden = true;
    expect((await react('ann_bell', 'saved', false)).code).toBe(200);
    expect(db.docs['tip_reactions/me_ann_bell']).toBeUndefined();
    expect(db.docs['tips/ann_bell'].counts.saved).toBe(0);
  });
  it('marks and reports need a verified email', async () => {
    caller = { uid: 'me', emailVerified: false };
    expect((await react('ann_bell', 'helpful', true)).code).toBe(403);
    expect((await report()).code).toBe(403);
    expect(db.docs['tips/ann_bell']).toMatchObject({ reportCount: 0, counts: { helpful: 0, saved: 0 } });
  });
  it("can't react to your own, a held, hidden, blocked or missing tip", async () => {
    expect((await react('me_bell', 'helpful', true)).code).toBe(400);
    for (const id of ['cat_bell', 'dan_bell', 'fay_bell', 'gus_bell', 'nope_bell']) expect((await react(id, 'helpful', true)).code).toBe(404);
    expect((await react('ann_bell', 'loved', true)).code).toBe(400);
  });
  it('hides a tip after 2 distinct reports, never twice from one person, and keeps reporters off the tip', async () => {
    expect((await report()).code).toBe(200);
    await report();
    expect(db.docs['tips/ann_bell']).toMatchObject({ reportCount: 1, hidden: false });
    expect(db.docs['tips/ann_bell'].reportedBy).toBeUndefined();
    expect(db.docs['tip_reports/ann_bell_g-ann_me']).toMatchObject({ uid: 'me', tipId: 'ann_bell', gen: 'g-ann', reason: 'offensive' });
    caller = { uid: 'zed', emailVerified: true };
    await report();
    expect(db.docs['tips/ann_bell']).toMatchObject({ reportCount: 2, hidden: true });
    caller = { uid: 'me', emailVerified: true };
    expect((await list()).body.tips.map((t) => t.id)).not.toContain('ann_bell');
    expect((await report('bob_bell', 'because')).code).toBe(400);
  });
  it('a report never lands on a different post re-posted at the same id', async () => {
    const real = db.runTransaction;
    db.runTransaction = async (fn) => {
      db.docs['tips/ann_bell'] = { ...db.docs['tips/ann_bell'], gen: 'g-repost' };
      return real(fn);
    };
    expect((await reportTip(db, 'me', { tipId: 'ann_bell', reason: 'spam' }))[0]).toBe(404);
    db.runTransaction = real;
    expect(db.docs['tips/ann_bell'].reportCount).toBe(0);
  });
});
