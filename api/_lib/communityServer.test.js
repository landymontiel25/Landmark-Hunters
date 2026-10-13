import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { computeCommunity, communityRegionsOf } = await import('./communityServer.js');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const tip = (author, landmarkId, extra = {}) => ({ authorUid: author, authorName: author.toUpperCase(), landmarkId, region: 'philly', status: 'live', hidden: false, verified: true, visitMonth: '2026-10', text: `tip by ${author}`, ...extra });

const base = (density = { ramp: 1, gateOpen: false }) =>
  fakeDb({
    'community_density/philly': density,
    'tips/nbr_a': tip('nbr', 'a'),
    'tips/fol_b': tip('fol', 'b'),
    'tips/str_c': tip('str', 'c'),
    'tips/blk_d': tip('blk', 'd'),
    'tips/me_e': tip('me', 'e'),
    'tips/old_f': tip('old', 'f', { visitMonth: '2025-01' }),
    'tips/hid_g': tip('hid', 'g', { hidden: true }),
    'tips/mia_x': tip('mia', 'x', { region: 'miami' }),
    'mapr_neighbors/me': { global: [{ uid: 'nbr', score: 0.8 }, { uid: 'old', score: 0.8 }], byRegion: {} },
    'follows/me_fol': { followerUid: 'me', followeeUid: 'fol' },
    'blocks/blk_me': { blockerUid: 'blk', blockedUid: 'me' },
  });

describe('computeCommunity', () => {
  it('lifts places by their best finder for this viewer, labels who found it, skips own, blocked and hidden tips', async () => {
    const out = await computeCommunity(base(), 'me', ['philly', 'miami'], { nowMs: NOW });
    expect(Object.keys(out)).toEqual(['philly']);
    const p = out.philly.places;
    expect(p.a.lift).toBeCloseTo(1.48, 3);
    expect(p.a.finder).toEqual({ uid: 'nbr', name: 'NBR', relation: 'neighbor', match: 'High' });
    expect(p.a.likeYou).toBe(true);
    expect(p.b.lift).toBeCloseTo(1.4, 3);
    expect(p.b.finder.relation).toBe('follow');
    expect(p.c.lift).toBe(1);
    expect(p.c.likeYou).toBe(false);
    expect(p.d).toBeUndefined();
    expect(p.e).toBeUndefined();
    expect(p.g).toBeUndefined();
    // An old visit keeps less of its lift.
    expect(p.f.lift).toBeLessThan(p.a.lift);
    expect(p.a.tip).toBeUndefined();
  });
  it('a Trusted finder in the city reaches everyone, and reputation lifts their weight (Phase 4)', async () => {
    const db = base();
    db.docs['reputation_scores/str'] = { byRegion: { philly: { score: 125, people: 12 } } };
    db.docs['reputation/str'] = { levels: { philly: 'Trusted' }, badges: [] };
    const c = (await computeCommunity(db, 'me', ['philly'], { nowMs: NOW })).philly.places.c;
    expect(c.lift).toBeCloseTo(1.25, 3);
    expect(c.likeYou).toBe(true);
    expect(c.finder).toMatchObject({ relation: 'trusted', levelLabel: 'Trusted in Philadelphia' });
  });
  it('week 1 (ramp 0) lifts nothing, but still lists the finds', async () => {
    const out = await computeCommunity(base({ ramp: 0, gateOpen: false }), 'me', ['philly'], { nowMs: NOW });
    expect(out.philly.places.a.lift).toBe(1);
    expect(out.philly.places.a.likeYou).toBe(true);
  });
  it('adds the tip text only when asked (Mapr chat)', async () => {
    const out = await computeCommunity(base(), 'me', ['philly'], { nowMs: NOW, withText: true });
    expect(out.philly.places.a.tip).toBe('tip by nbr');
  });
  it('keeps only launch regions', () => {
    expect(communityRegionsOf(['philly', 'miami', 'villanova', 'philly'])).toEqual(['philly', 'villanova']);
  });
});
