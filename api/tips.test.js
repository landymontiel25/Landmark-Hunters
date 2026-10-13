import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

let db;
let caller;

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => caller }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => db, adminBucket: async () => null }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('../src/data/regions.js', () => ({ canonicalRegionId: (r) => (r === 'coralgables' ? 'miami' : r) }));

const { default: handler } = await import('./tips.js');

const call = async (method, { query = {}, body = {} } = {}) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader() {}, end: vi.fn(() => res) };
  await handler({ method, headers: {}, query, body }, res);
  return { code: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};
const tip = (authorUid, o = {}) => ({ authorUid, authorName: authorUid, landmarkId: 'bell', region: 'philly', text: `Tip from ${authorUid}.`, tags: [], status: 'live', hidden: false, reportCount: 0, counts: { helpful: 0, saved: 0 }, verified: true, createdAtMs: 1, heldReasons: ['x'], ...o });
const list = () => call('GET', { query: { region: 'philly', landmarkId: 'bell' } });

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
  it('lists live tips at the place, newest first, plus your own (held) tip', async () => {
    const { code, body } = await list();
    expect(code).toBe(200);
    expect(body.tips.map((t) => t.id)).toEqual(['ann_bell', 'bob_bell', 'me_bell']);
    expect(body.tips[2]).toMatchObject({ mine: true, status: 'held' });
    expect(body.tips[0].status).toBeUndefined();
  });
  it('hides tips across a block both ways, held, hidden and other-region tips', async () => {
    const ids = (await list()).body.tips.map((t) => t.id);
    for (const hidden of ['cat_bell', 'dan_bell', 'eve_bell', 'fay_bell', 'gus_bell']) expect(ids).not.toContain(hidden);
  });
  it('never returns reporters, held reasons or who marked a tip', async () => {
    const t = (await list()).body.tips[0];
    expect(Object.keys(t).sort()).toEqual(['authorName', 'authorUid', 'counts', 'createdAt', 'id', 'landmarkId', 'mine', 'photoURL', 'region', 'tags', 'text', 'verified', 'visitAt'].sort());
  });
  it("records which of others' live tips you were shown, keeping the first time", async () => {
    await list();
    expect(db.docs['tip_views/me_ann_bell']).toMatchObject({ uid: 'me', tipId: 'ann_bell', authorUid: 'ann' });
    expect(db.docs['tip_views/me_me_bell']).toBeUndefined();
    db.docs['tip_views/me_ann_bell'].firstAt = 5;
    await list();
    expect(db.docs['tip_views/me_ann_bell'].firstAt).toBe(5);
  });
  it('needs a sign-in and a place', async () => {
    expect((await call('GET', { query: { region: 'philly' } })).code).toBe(400);
    caller = null;
    expect((await list()).code).toBe(401);
  });
});

describe('api/tips: helpful, saved and reports', () => {
  const react = (tipId, kind, on) => call('POST', { body: { action: 'react', tipId, kind, on } });
  it('marks a tip helpful and saved, counting each person once, and unmarks', async () => {
    expect((await react('ann_bell', 'helpful', true)).code).toBe(200);
    await react('ann_bell', 'helpful', true);
    await react('ann_bell', 'saved', true);
    expect(db.docs['tips/ann_bell'].counts).toEqual({ helpful: 1, saved: 1 });
    expect(db.docs['tip_reactions/me_ann_bell']).toMatchObject({ uid: 'me', tipId: 'ann_bell', helpful: true, saved: true });
    await react('ann_bell', 'helpful', false);
    await react('ann_bell', 'saved', false);
    expect(db.docs['tips/ann_bell'].counts).toEqual({ helpful: 0, saved: 0 });
    expect(db.docs['tip_reactions/me_ann_bell']).toBeUndefined();
    expect((await list()).body.reactions).toEqual({});
  });
  it("can't react to your own, a held, hidden or blocked tip", async () => {
    expect((await react('me_bell', 'helpful', true)).code).toBe(400);
    for (const id of ['cat_bell', 'dan_bell', 'fay_bell', 'gus_bell', 'nope_bell']) expect((await react(id, 'helpful', true)).code).toBe(404);
    expect((await react('ann_bell', 'loved', true)).code).toBe(400);
  });
  it('hides a tip after 2 distinct reports, never twice from one person, and keeps reporters off the tip', async () => {
    const report = () => call('POST', { body: { action: 'report', tipId: 'ann_bell', reason: 'offensive' } });
    expect((await report()).code).toBe(200);
    await report();
    expect(db.docs['tips/ann_bell']).toMatchObject({ reportCount: 1, hidden: false });
    expect(db.docs['tips/ann_bell'].reportedBy).toBeUndefined();
    expect(db.docs['tips/ann_bell/reports/me']).toMatchObject({ uid: 'me', reason: 'offensive' });
    caller = { uid: 'zed', emailVerified: true };
    await report();
    expect(db.docs['tips/ann_bell']).toMatchObject({ reportCount: 2, hidden: true });
    caller = { uid: 'me', emailVerified: true };
    expect((await list()).body.tips.map((t) => t.id)).not.toContain('ann_bell');
    expect((await call('POST', { body: { action: 'report', tipId: 'bob_bell', reason: 'because' } })).code).toBe(400);
  });
});
