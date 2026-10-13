import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './_lib/fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { buildFeed } = await import('./feed.js');
const { getRegion } = await import('../src/data/regions.js');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const philly = getRegion('philly').landmarks;

describe('buildFeed', () => {
  it('mixes tips (finder named, why) with Mapr picks every 6th, leaving out places you rated', async () => {
    const places = {};
    philly.slice(0, 8).forEach((l, i) => {
      places[l.id] = { lift: 1.2, likeYou: true, finders: 1, finder: { uid: `f${i}`, name: `F${i}`, relation: i === 0 ? 'follow' : 'neighbor', match: i === 0 ? null : 'High' }, tip: `Tip ${i}` };
    });
    const rated = philly[1];
    const db = fakeDb({
      'users/me': { tagScores: { philly: { 'history-culture': 40, food: 20 } }, tagScoresAt: { philly: { 'history-culture': NOW, food: NOW } } },
      'reviews/me_x': { userId: 'me', landmarkId: rated.id, region: 'philly', ratingTier: 'highly-recommend' },
    });
    const feed = await buildFeed(db, 'me', 'philly', { now: NOW, models: { community: { philly: { places } } } });
    expect(feed.length).toBeGreaterThan(8);
    expect(feed.some((x) => x.place.id === rated.id)).toBe(false);
    expect(feed[5].kind).toBe('mapr');
    expect(feed[5].reason).toBe("Mapr thinks you'd like");
    const tip = feed.find((x) => x.kind === 'tip' && x.tip.authorName === 'F2');
    expect(tip.tip).toMatchObject({ text: 'Tip 2', why: 'Taste match: High' });
    expect(JSON.stringify(feed)).not.toMatch(/"lift"|"score"/);
  });
});
