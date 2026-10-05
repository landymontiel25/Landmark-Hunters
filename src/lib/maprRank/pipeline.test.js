// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { composePicks, pickKey, rankNearbyCandidates } from '../nearbyPicks';
import { FEATURES } from './config.js';
import { scorePicks, planExploration, likedByRegion, _resetNcfCache } from './rank.js';
import { serializeModel, trainNcf } from './ncf.js';
import { seededRandom } from './experiments.js';

// End-to-end over the real catalog: location + landmarks -> scored, ranked,
// composed picks, with each Phase 1 step switched on through `features`.

const MILAN = { lat: 45.4642, lng: 9.19 };
const MADRID = { lat: 40.4168, lng: -3.7038 };
const NOW = Date.parse('2026-10-01T10:00:00Z');
const ALL_ON = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { enabled: true, rollout: 100 }]));
const ALL_OFF = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { enabled: false, rollout: 0 }]));
const only = (...keys) => ({ ...ALL_OFF, ...Object.fromEntries(keys.map((k) => [k, { enabled: true, rollout: 100 }])) });
const profile = {
  tagScores: { all: { food: 30, 'art-museums': 25, 'history-culture': 20, 'parks-nature': 5 } },
  tagScoresAt: { all: { food: NOW, 'art-museums': NOW, 'history-culture': NOW, 'parks-nature': NOW } },
  tagCounts: { all: { food: 6, 'art-museums': 5, 'history-culture': 4, 'parks-nature': 1 } },
};
const run = (extra = {}) => rankNearbyCandidates({ profile, origin: MILAN, miles: 5, now: NOW, date: new Date(NOW), uid: 'user-1', ...extra });

beforeEach(() => {
  localStorage.clear();
  _resetNcfCache();
});

describe('Week 1: distance decay in the real ranking', () => {
  it('ranks by tag score x 1 / (1 + km / 1.5) and logs the parts', () => {
    const { usual } = run({ features: only('distanceDecay') });
    expect(usual.length).toBeGreaterThan(10);
    for (let i = 1; i < usual.length; i++) expect(usual[i].finalScore).toBeLessThanOrEqual(usual[i - 1].finalScore);
    for (const p of usual.slice(0, 20)) {
      const t = p.telemetry;
      expect(t.distanceKm).toBeCloseTo(p.distanceMeters / 1000, 2);
      expect(t.scoreAfterDecay).toBeCloseTo(t.scoreBeforeDecay / (1 + p.distanceMeters / 1000 / 1.5), 3);
    }
  });

  it('puts a near place ahead of a far one with the same tag score', () => {
    const a = { id: 'near', region: 'milan', tagScore: 20, distanceMeters: 300 };
    const b = { id: 'far', region: 'milan', tagScore: 20, distanceMeters: 4000 };
    expect(scorePicks({ usual: [b, a], uid: 'u', features: only('distanceDecay') }).usual.map((p) => p.id)).toEqual(['near', 'far']);
  });

  it('cold start: no ratings at all still gives a distance-ordered baseline', () => {
    const { usual, fresh } = rankNearbyCandidates({ profile: {}, origin: MILAN, miles: 3, now: NOW, date: new Date(NOW), uid: 'new-user', features: only('distanceDecay') });
    expect(usual).toHaveLength(0);
    expect(fresh.length).toBeGreaterThan(5);
    for (let i = 1; i < fresh.length; i++) {
      if (fresh[i].finalScore === fresh[i - 1].finalScore) expect(fresh[i].distanceMeters).toBeGreaterThanOrEqual(fresh[i - 1].distanceMeters);
    }
  });

  it('keeps the old linear rule for users outside the rollout', () => {
    const { usual } = run({ features: ALL_OFF });
    const legacy = (p) => (p.tagScore || 0) - (p.distanceMeters / 1609.34) * 1.5;
    for (let i = 1; i < usual.length; i++) expect(legacy(usual[i])).toBeLessThanOrEqual(legacy(usual[i - 1]) + 1e-9);
    expect(usual[0].telemetry.decayMultiplier).toBeNull();
  });
});

describe('Week 2: item-item similarity in the real ranking', () => {
  it('boosts places similar to ones the user loved, per region', () => {
    const base = run({ features: only('distanceDecay') }).usual;
    const target = base[base.length - 1];
    const liked = base.slice(0, 5).map((p) => p.id);
    const myReviews = Object.fromEntries(liked.map((id) => [id, { landmarkId: id, region: 'milan', ratingTier: 'highly-recommend', visited: false }]));
    const similarity = { milan: Object.fromEntries(liked.map((id) => [id, [[target.id, 0.9]]])) };
    const boosted = run({ features: only('distanceDecay', 'itemSimilarity'), myReviews, models: { similarity } }).usual;
    const t = boosted.find((p) => p.id === target.id);
    expect(t.telemetry.collabBoost).toBe(0.2);
    expect(t.finalScore).toBeCloseTo(t.telemetry.scoreAfterDecay * 1.2, 3);
    expect(boosted.findIndex((p) => p.id === target.id)).toBeLessThanOrEqual(base.findIndex((p) => p.id === target.id));
  });

  it('scores Milan and Madrid independently', () => {
    const milan = run({ features: only('distanceDecay', 'itemSimilarity') }).usual;
    const id = milan[0].id;
    const myReviews = { x: { landmarkId: 'x', region: 'milan', ratingTier: 'highly-recommend' } };
    const models = { similarity: { milan: { x: [[id, 1]] } } };
    const inMadrid = rankNearbyCandidates({ profile, origin: MADRID, miles: 5, now: NOW, date: new Date(NOW), uid: 'user-1', myReviews, models, features: only('distanceDecay', 'itemSimilarity') }).usual;
    expect(inMadrid.length).toBeGreaterThan(0);
    expect(inMadrid.every((p) => p.region === 'madrid' && p.telemetry.collabBoost === 0)).toBe(true);
    const inMilan = run({ myReviews, models, features: only('distanceDecay', 'itemSimilarity') }).usual;
    expect(inMilan.find((p) => p.id === id).telemetry.collabBoost).toBe(0.2);
  });

  it('likedByRegion keeps 4+ star ratings only', () => {
    expect(likedByRegion({ a: { landmarkId: 'a', region: 'r', ratingTier: 'highly-recommend' }, b: { landmarkId: 'b', region: 'r', ratingTier: 'worth-trying' } })).toEqual({ r: ['a'] });
  });
});

describe('Week 3: NCF blend and fallbacks', () => {
  const base = run({ features: only('distanceDecay') }).usual;
  const keys = base.slice(0, 30).map(pickKey);
  const positives = [];
  for (let u = 0; u < 12; u++) for (let k = 0; k < 6; k++) positives.push({ userId: u === 0 ? 'user-1' : `u${u}`, itemKey: keys[(u * 3 + k * 5) % keys.length], at: NOW - (k * 13 + u) * 86400000 });
  const trained = trainNcf(positives, { now: NOW, budgetMs: 10_000 });
  const { shared, users } = serializeModel(trained, { meta: { version: 'v1' } });
  const models = { ncf: { ...shared, version: 'v1' }, userEmbedding: users['user-1'] };

  it('final = 0.4 * normalized base + 0.6 * ncf, within [0, 1]', () => {
    const { usual, meta } = run({ features: only('distanceDecay', 'ncf'), models });
    expect(meta.ncfUsed).toBe(true);
    for (const p of usual) {
      expect(p.finalScore).toBeGreaterThanOrEqual(0);
      expect(p.finalScore).toBeLessThanOrEqual(1);
    }
    const scored = usual.find((p) => p.telemetry.ncfScore != null);
    expect(scored.telemetry.ncfScore).toBeGreaterThan(0);
    expect(scored.telemetry.ncfScore).toBeLessThan(1);
  });

  it('falls back to tag scoring with no model, no user embedding or a broken model', () => {
    for (const [m, why] of [
      [null, 'ncf-no-model'],
      [{ ncf: models.ncf }, 'ncf-no-model'],
      [{ ncf: { ...models.ncf, layers: 'corrupt' }, userEmbedding: models.userEmbedding }, 'ncf-no-model'],
    ]) {
      const r = run({ features: only('distanceDecay', 'ncf'), models: m });
      expect(r.meta.ncfUsed).toBe(false);
      expect(r.meta.fallbacks.length).toBeGreaterThan(0);
      expect(r.usual.length).toBeGreaterThan(10);
      void why;
    }
  });

  it('serves cached NCF scores when inference runs over its 10 ms budget', () => {
    run({ features: only('distanceDecay', 'ncf'), models }); // fills the cache
    let t = 0;
    const slowClock = () => (t += 5); // every check costs 5 "ms"
    const usual = base.map((p) => ({ ...p }));
    const r = scorePicks({ usual, uid: 'user-1', models, features: only('distanceDecay', 'ncf'), clock: slowClock });
    expect(r.meta.fallbacks).toContain('ncf-latency');
    expect(r.usual.filter((p) => p.telemetry.ncfScore != null).length).toBeGreaterThan(2);
  });

  it('control users never touch the model', () => {
    const r = run({ features: only('distanceDecay'), models });
    expect(r.meta.variants.ncf).toBe('control');
    expect(r.usual.every((p) => p.telemetry.ncfScore === null)).toBe(true);
  });
});

describe('Week 4: exploration end to end', () => {
  it('mixes exploration into about epsilon of the slots, never repeating exploitation picks', () => {
    const r = run({ features: only('distanceDecay', 'exploration'), explore: { createdAtMs: NOW - 60 * 86400000, myReviews: {} } });
    expect(r.exploration).not.toBeNull();
    expect(r.exploration.explore.length).toBe(20);
    const top = new Set(r.exploration.exploit.slice(0, 8).map(pickKey));
    expect(r.exploration.explore.some((p) => top.has(pickKey(p)))).toBe(false);
    let explored = 0;
    let total = 0;
    for (let s = 0; s < 400; s++) {
      const set = composePicks({ usual: r.usual, fresh: r.fresh, exploration: r.exploration, rng: seededRandom(s) });
      expect(set).toHaveLength(4);
      expect(new Set(set.map(pickKey)).size).toBe(4);
      explored += set.filter((p) => p.slot === 'explore').length;
      total += set.length;
    }
    expect(Math.abs(explored / total - r.exploration.epsilon)).toBeLessThan(0.05);
  });

  it('a quiet week (or a server flag) raises exploration to 50%', () => {
    const r = run({ features: only('distanceDecay', 'exploration'), explore: { createdAtMs: NOW - 60 * 86400000, serverStagnating: true } });
    expect(r.exploration.stagnating).toBe(true);
    expect(r.exploration.epsilon).toBe(0.5);
  });

  it('control users get today\'s composition (one "something new")', () => {
    const r = run({ features: only('distanceDecay') });
    expect(r.exploration).toBeNull();
    const set = composePicks({ usual: r.usual, fresh: r.fresh });
    expect(set.filter((p) => p.pickType === 'new')).toHaveLength(1);
  });

  it('exploration picks keep quality: never a place rated under 3', () => {
    const r = run({ features: only('distanceDecay', 'exploration'), explore: { ratings: { [run().usual[0].id]: { avg: 2, count: 10 } } } });
    expect(r.exploration.explore.map((p) => p.id)).not.toContain(run().usual[0].id);
  });

  it('planExploration is null for control', () => {
    expect(planExploration({ uid: 'u', features: only('distanceDecay') })).toBeNull();
  });
});

describe('load: 100 concurrent requests', () => {
  it('keeps p99 ranking latency under 100 ms with every step on', async () => {
    const models = { similarity: { milan: {} } };
    run({ features: ALL_ON, models }); // warm-up
    const times = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => {
          const t0 = performance.now();
          rankNearbyCandidates({ profile, origin: { lat: MILAN.lat + (i % 10) * 0.001, lng: MILAN.lng }, miles: 5, now: NOW, date: new Date(NOW), uid: `load-${i}`, models, features: ALL_ON });
          return performance.now() - t0;
        })
      )
    );
    times.sort((a, b) => a - b);
    const p99 = times[98];
    // Logged so a regression is visible in the test output.
    console.info(`rankNearbyCandidates p50 ${times[49].toFixed(1)} ms, p99 ${p99.toFixed(1)} ms`);
    expect(p99).toBeLessThan(100);
  }, 60_000);
});
