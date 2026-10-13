import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { buildEvents, buildReputation, runReputation } = await import('./reputationJob.js');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86400000;
const tip = { id: 'fin_bell', authorUid: 'fin', landmarkId: 'bell', region: 'philly', status: 'live', hidden: false, gen: 'g1' };

describe('buildEvents (step 8)', () => {
  it('helpful, saved, went within 30 days of seeing the tip with a verified visit, then loved', () => {
    const events = buildEvents({
      tips: [tip, { ...tip, id: 'fin_gone', landmarkId: 'gone', status: 'removed' }],
      reactions: [
        { uid: 'a', tipId: 'fin_bell', gen: 'g1', helpful: true, saved: true, helpfulAt: NOW - DAY, savedAt: NOW - DAY },
        { uid: 'b', tipId: 'fin_bell', gen: 'old', helpful: true, helpfulAt: NOW },
        { uid: 'fin', tipId: 'fin_bell', gen: 'g1', helpful: true, helpfulAt: NOW },
        { uid: 'c', tipId: 'fin_gone', gen: 'g1', helpful: true, helpfulAt: NOW },
      ],
      views: [
        { uid: 'a', tipId: 'fin_bell', gen: 'g1', firstAt: NOW - 20 * DAY },
        { uid: 'late', tipId: 'fin_bell', gen: 'g1', firstAt: NOW - 50 * DAY },
        { uid: 'unver', tipId: 'fin_bell', gen: 'g1', firstAt: NOW - 5 * DAY },
      ],
      checkins: [
        { userId: 'a', region: 'philly', landmarkId: 'bell', createdAt: NOW - 10 * DAY, presence: { verified: true } },
        { userId: 'late', region: 'philly', landmarkId: 'bell', createdAt: NOW - 5 * DAY, presence: { verified: true } },
        { userId: 'unver', region: 'philly', landmarkId: 'bell', createdAt: NOW - DAY, presence: { verified: false } },
      ],
      reviews: [{ userId: 'a', region: 'philly', landmarkId: 'bell', ratingTier: 'highly-recommend', ratedAt: NOW - 9 * DAY }],
    });
    expect(events.map((e) => `${e.actorUid}:${e.kind}:${e.weight}`).sort()).toEqual(['a:helpful:1', 'a:loved:5', 'a:saved:2', 'a:went:10']);
    expect(events.every((e) => e.finderUid === 'fin' && e.region === 'philly')).toBe(true);
  });
});

describe('buildReputation (step 9, levels, badges, founding)', () => {
  const established = (uids) => ({ verifiedCount: new Map(uids.map((u) => [u, 3])), accountAgeDays: new Map(uids.map((u) => [u, 30])) });
  it('three established people who went and loved make a Local, a founding discoverer in a launch city', () => {
    const events = ['a', 'b', 'c'].flatMap((u) => [
      { finderUid: 'fin', actorUid: u, region: 'philly', kind: 'went', weight: 10, at: NOW },
      { finderUid: 'fin', actorUid: u, region: 'philly', kind: 'loved', weight: 5, at: NOW },
    ]);
    const rep = buildReputation({ events, tips: [tip], ...established(['a', 'b', 'c']), friendEdges: new Set(), nowMs: NOW });
    expect(rep.scores.get('fin').philly).toEqual({ score: 45, people: 3 });
    expect(rep.levels.get('fin')).toEqual({ philly: 'Local' });
    expect(rep.founding.philly).toEqual(['fin']);
    expect(rep.badges.get('fin')).toEqual(['first-find', 'founding-philly']);
  });
  it('friends count 0.5 and new accounts 0.3, so a friend ring stays below Local', () => {
    const events = ['a', 'b', 'c'].map((u) => ({ finderUid: 'fin', actorUid: u, region: 'philly', kind: 'went', weight: 10, at: NOW }));
    const rep = buildReputation({ events, tips: [tip], ...established(['a', 'b', 'c']), friendEdges: new Set(['fin_a', 'fin_b', 'fin_c']), nowMs: NOW });
    expect(rep.scores.get('fin').philly.score).toBe(15);
    expect(rep.levels.get('fin')).toBeUndefined();
  });
  it('keeps founding at 25 and badges once earned', () => {
    const full = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const rep = buildReputation({ events: [], tips: [], verifiedCount: new Map(), accountAgeDays: new Map(), friendEdges: new Set(), nowMs: NOW, prevBadges: new Map([['old', ['first-find', 'went-10', 'trusted-philly']]]), founding: { philly: full } });
    expect(rep.founding.philly).toHaveLength(25);
    expect(rep.badges.get('old')).toEqual(['first-find', 'went-10']);
  });
});

describe('runReputation', () => {
  it('writes new events (server only), scores, and a public doc with levels and badges, never points', async () => {
    const db = fakeDb({
      'tip_reactions/a_fin_bell': { uid: 'a', tipId: 'fin_bell', gen: 'g1', helpful: true, helpfulAt: NOW },
    });
    const ds = { truncated: [], tips: [tip], checkins: [], reviews: [], users: [{ uid: 'a', createdAt: NOW - 30 * DAY }] };
    const out = await runReputation(db, ds, { nowMs: NOW });
    expect(out.newEvents).toBe(1);
    expect(db.docs['influence_events/fin_bell_a_helpful']).toMatchObject({ finderUid: 'fin', actorUid: 'a', kind: 'helpful' });
    expect(db.docs['reputation_scores/fin'].byRegion.philly.score).toBeCloseTo(0.3, 5);
    expect(db.docs['reputation/fin']).toMatchObject({ levels: {}, badges: ['first-find'] });
    expect(JSON.stringify(db.docs['reputation/fin'])).not.toContain('score');
    expect((await runReputation(db, ds, { nowMs: NOW })).newEvents).toBe(0);
  });
});
