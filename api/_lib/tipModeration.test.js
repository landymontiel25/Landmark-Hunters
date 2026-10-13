import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

const deleted = [];
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('./firebaseAdmin.js', () => ({ adminBucket: async () => ({ file: (p) => ({ delete: async () => deleted.push(p) }) }) }));

const { moderateTip, sweepTipOrphans, tipsQueue } = await import('./tipModeration.js');

let db;
const tip = (o = {}) => ({ authorUid: 'ann', authorName: 'ann', landmarkId: 'bell', region: 'philly', text: 'Go early.', tags: [], status: 'live', hidden: false, reportCount: 0, heldReasons: [], gen: 'g1', createdAtMs: 1, photoPath: null, ...o });

beforeEach(() => {
  deleted.length = 0;
  db = fakeDb({
    'tips/ann_held': tip({ status: 'held', heldReasons: ['profanity'] }),
    'tips/ann_rep': tip({ reportCount: 2, hidden: true, photoPath: 'tip_photos/ann/p.jpg', photoURL: 'u' }),
    'tips/ann_wd': tip({ status: 'withdrawn', reportCount: 2, hidden: true }),
    'tips/ann_ok': tip(),
    'tips/ann_gone': tip({ status: 'removed', reportCount: 3 }),
    'tip_reports/ann_rep_g1_x': { uid: 'x', tipId: 'ann_rep', gen: 'g1', reason: 'spam', at: 5 },
    'tip_reports/ann_rep_g0_y': { uid: 'y', tipId: 'ann_rep', gen: 'g0', reason: 'offensive', at: 1 },
    'tip_reactions/z_ann_wd': { uid: 'z', tipId: 'ann_wd', gen: 'g1', helpful: true },
  });
});

describe('tips queue', () => {
  it('lists held, withdrawn and reported tips (not removed or clean ones), with this post\'s report reasons and never who reported', async () => {
    const { rows, counts } = await tipsQueue(db);
    expect(rows.map((r) => r.id)).toEqual(['ann_held', 'ann_wd', 'ann_rep']);
    expect(counts).toEqual({ held: 1, reported: 1, withdrawn: 1 });
    const rep = rows.find((r) => r.id === 'ann_rep');
    expect(rep.reports).toEqual([{ reason: 'spam', at: 5 }]);
    expect(JSON.stringify(rows)).not.toContain('"uid"');
  });
});

describe('moderateTip', () => {
  it('approve puts a held or reported tip live with its reports resolved', async () => {
    expect((await moderateTip(db, 'ann_rep', 'approve')).body.result).toBe('live');
    expect(db.docs['tips/ann_rep']).toMatchObject({ status: 'live', hidden: false, reportCount: 0, reviewDecision: 'approve' });
    expect(db.docs['tip_reports/ann_rep_g1_x'].resolvedAt).toBeTruthy();
    expect((await tipsQueue(db)).rows.map((r) => r.id)).not.toContain('ann_rep');
    await moderateTip(db, 'ann_held', 'approve');
    expect(db.docs['tips/ann_held']).toMatchObject({ status: 'live', heldReasons: [] });
  });
  it('approve on a withdrawn tip deletes it with its marks, so its author can post again', async () => {
    expect((await moderateTip(db, 'ann_wd', 'approve')).body.result).toBe('deleted');
    expect(db.docs['tips/ann_wd']).toBeUndefined();
    expect(db.docs['tip_reactions/z_ann_wd']).toBeUndefined();
  });
  it('remove hides the tip for good and deletes its photo; it can\'t be approved after', async () => {
    expect((await moderateTip(db, 'ann_rep', 'remove')).body.result).toBe('removed');
    expect(db.docs['tips/ann_rep']).toMatchObject({ status: 'removed', hidden: true, photoURL: null });
    expect(deleted).toEqual(['tip_photos/ann/p.jpg']);
    expect((await moderateTip(db, 'ann_rep', 'approve')).status).toBe(409);
  });
  it('clear deletes a tip but keeps its reports as the record', async () => {
    await moderateTip(db, 'ann_rep', 'clear');
    expect(db.docs['tips/ann_rep']).toBeUndefined();
    expect(db.docs['tip_reports/ann_rep_g1_x']).toBeDefined();
  });
  it('refuses bad input and missing tips', async () => {
    expect((await moderateTip(db, '../x', 'approve')).status).toBe(400);
    expect((await moderateTip(db, 'ann_ok', 'nuke')).status).toBe(400);
    expect((await moderateTip(db, 'nope', 'approve')).status).toBe(404);
  });
});

describe('sweepTipOrphans', () => {
  it('removes marks and views of a tip that is gone or an older post, keeps current ones, and never runs on partial data', async () => {
    db.docs['tip_reactions/z_gone'] = { tipId: 'nope', gen: 'g1' };
    db.docs['tip_views/z_old'] = { tipId: 'ann_ok', gen: 'g0' };
    db.docs['tip_views/z_ok'] = { tipId: 'ann_ok', gen: 'g1' };
    const tips = Object.entries(db.docs).filter(([k]) => k.startsWith('tips/')).map(([k, v]) => ({ id: k.slice(5), gen: v.gen }));
    expect(await sweepTipOrphans(db, tips, { truncated: ['tips'] })).toBe(0);
    expect(await sweepTipOrphans(db, undefined)).toBe(0);
    expect(await sweepTipOrphans(db, tips)).toBe(2);
    expect(db.docs['tip_reactions/z_gone']).toBeUndefined();
    expect(db.docs['tip_views/z_old']).toBeUndefined();
    expect(db.docs['tip_views/z_ok']).toBeDefined();
    expect(db.docs['tip_reactions/z_ann_wd']).toBeDefined();
  });
});
