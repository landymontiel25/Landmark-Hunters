import { describe, it, expect } from 'vitest';
import { mixExploration, rankPlaces, tasteScorer } from './surfaces.js';
import { FEATURES } from './config.js';
import { rankTripPicks } from '../tripPlanner.js';
import { seededRandom } from './experiments.js';
import { chatRanking, reviewsMap, summaryScorer } from '../../../api/_lib/maprChatRanking.js';
import { getRegion } from '../../data/regions.js';

const ON = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { enabled: true, rollout: 100 }]));
const MILAN = { lat: 45.4642, lng: 9.19 };
const NOW = Date.parse('2026-10-01T10:00:00Z');
const profile = { tagScores: { all: { food: 30, 'art-museums': 20 } }, tagScoresAt: { all: { food: NOW, 'art-museums': NOW } } };
const milan = getRegion('milan').landmarks.map((l) => ({ ...l, regionId: 'milan' }));

describe('rankPlaces (shared by every Mapr surface)', () => {
  it('orders by taste x distance decay and carries telemetry', () => {
    const { ranked } = rankPlaces({ places: milan, uid: 'u1', profile, origin: MILAN, now: NOW, features: ON });
    expect(ranked).toHaveLength(milan.length);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].finalScore).toBeLessThanOrEqual(ranked[i - 1].finalScore);
    expect(ranked[0].telemetry.distanceKm).not.toBeNull();
  });

  it('keeps the incoming order on ties (no taste, no location)', () => {
    const places = milan.slice(0, 5);
    const { ranked } = rankPlaces({ places, uid: 'u1', features: ON, scoreOf: () => 0 });
    expect(ranked.map((p) => p.id)).toEqual(places.map((p) => p.id));
  });

  it('boosts places similar to loved ones (same as the Map sheet)', () => {
    const [a, b] = milan;
    const myReviews = { [a.id]: { landmarkId: a.id, region: 'milan', ratingTier: 'highly-recommend' } };
    const { ranked } = rankPlaces({ places: [b], uid: 'u1', myReviews, models: { similarity: { milan: { [a.id]: [[b.id, 1]] } } }, features: ON, scoreOf: () => 10 });
    expect(ranked[0].telemetry.collabBoost).toBe(0.2);
    expect(ranked[0].finalScore).toBeCloseTo(12, 6);
  });

  it('mixes exploration slots into a pick set and tags them', () => {
    let explored = 0;
    for (let s = 0; s < 50; s++) {
      const { picks } = rankPlaces({ places: milan, uid: 'u1', profile, origin: MILAN, now: NOW, features: ON, count: 10, rng: seededRandom(s), explore: { createdAtMs: NOW - 90 * 864e5 } });
      expect(picks).toHaveLength(10);
      expect(new Set(picks.map((p) => p.id)).size).toBe(10);
      explored += picks.filter((p) => p.telemetry.explore).length;
    }
    expect(explored).toBeGreaterThan(0);
  });

  it('without a count, picks is the ranked list in the same order with set telemetry (Map sheet rows log these)', () => {
    const { ranked, picks } = rankPlaces({ places: milan, uid: 'u1', profile, origin: MILAN, now: NOW, features: ON });
    expect(picks.map((p) => p.id)).toEqual(ranked.map((p) => p.id));
    expect(picks[0].telemetry.variants).toBeTruthy();
    expect(picks[0].telemetry.rankPosition).toBe(1);
    expect(ranked[0].telemetry.variants).toBeUndefined();
  });

  it('mixExploration fills every slot even when a queue runs dry', () => {
    const out = mixExploration([{ id: 'a', region: 'r' }], { epsilon: 1, explore: [{ id: 'b', region: 'r' }] }, 3);
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('tasteScorer sums category scores', () => {
    expect(tasteScorer({ profile, now: NOW })({ regionId: 'milan', categories: ['food', 'art-museums'] })).toBeCloseTo(50, 0);
  });
});

describe('trip planner uses the shared ranking', () => {
  it('ranks "The usual" with distance when signed in', () => {
    const picks = rankTripPicks({ pickType: 'usual', profile, regionIds: ['milan'], now: NOW, uid: 'u1', origin: MILAN });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0].telemetry.distanceKm).not.toBeNull();
  });
  it('keeps the older order without a uid', () => {
    const picks = rankTripPicks({ pickType: 'usual', profile, regionIds: ['milan'], now: NOW });
    expect(picks.every((p) => !p.telemetry)).toBe(true);
  });
});

describe('Mapr chat ranking block', () => {
  const curated = milan;
  it('lists Mapr\'s order for a solo request, skipping visited places', () => {
    const visited = milan[0];
    const r = chatRanking({ uid: 'u1', pool: curated, curated, regionsChosen: true, near: MILAN, tagScoreSummary: { all: { food: 30 } }, reviews: [{ landmarkId: visited.id, region: 'milan', tier: 'highly-recommend', visited: true }], now: NOW, rng: seededRandom(1) });
    expect(r.text).toContain("MAPR'S RANKING");
    expect(r.ids.size).toBe(15);
    expect(r.ids.has(`milan/${visited.id}`)).toBe(false);
    expect(Object.values(r.telemetry)[0].variants).toBeTruthy();
  });
  it('gives no block for a group request or with nothing to rank', () => {
    expect(chatRanking({ uid: 'u1', pool: curated, curated, regionsChosen: true, requestFor: 'group' })).toBeNull();
    expect(chatRanking({ uid: 'u1', pool: [], curated, regionsChosen: false, near: null })).toBeNull();
  });
  it('reads the client summary and reviews', () => {
    expect(summaryScorer({ all: { food: 5, 'art-museums': 2 } })({ categories: ['food', 'art-museums'] })).toBe(7);
    expect(reviewsMap([{ landmarkId: 'x', region: 'milan', tier: 'highly-recommend' }, { tier: 'bogus', landmarkId: 'y' }])).toEqual({ x: { landmarkId: 'x', region: 'milan', ratingTier: 'highly-recommend', visited: true } });
  });
});
