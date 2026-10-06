import { describe, expect, it } from 'vitest';
import { gradedNdcg, meanSd, pairwiseAccuracy, rankingMetrics } from '../evaluator.js';
import { calculateMatch, simulateInteraction } from '../interaction-simulator.js';
import { ARCHETYPES } from '../synthetic-users.js';
import { NCFModel } from '../ncf-model.js';
import { emulatorDb } from '../lib/emulator.js';

describe('evaluator', () => {
  it('ranking metrics on a known order', () => {
    const m = rankingMetrics([0.9, 0.8, 0.1, 0.05], [1, 0, 0, 1], 2);
    expect(m.recall).toBe(0.5);
    expect(m.hit).toBe(1);
    expect(m.ndcg).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 10);
    expect(m.ap).toBeCloseTo(0.5, 10);
  });
  it('pairwise accuracy counts ties as half', () => {
    expect(pairwiseAccuracy([1, 0.5, 0.5], [true, false, false])).toEqual({ right: 2, pairs: 2 });
    expect(pairwiseAccuracy([0.5, 0.5], [true, false])).toEqual({ right: 0.5, pairs: 1 });
    expect(pairwiseAccuracy([1, 2], [true, true])).toBeNull();
  });
  it('graded NDCG is 1 for the ideal order', () => {
    expect(gradedNdcg([3, 2, 1], [3, 1, 0])).toBe(1);
    expect(gradedNdcg([1, 2, 3], [3, 1, 0])).toBeLessThan(1);
  });
  it('meanSd', () => {
    expect(meanSd([1, 3])).toMatchObject({ mean: 2, sd: Math.SQRT2, n: 2 });
  });
});

describe('synthetic users', () => {
  it('has 100+ archetypes with unique names', () => {
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ARCHETYPES.map((a) => a.name)).size).toBe(ARCHETYPES.length);
  });
  it('a liked place matches high, a disliked one low', () => {
    const w = { likes: { 'k:italian': 1 }, dislikes: { 'c:parks-nature': 0.6 } };
    expect(calculateMatch(w, new Set(['k:italian']))).toBeGreaterThan(0.7);
    expect(calculateMatch(w, new Set(['c:parks-nature']))).toBeLessThan(0.2);
    expect(calculateMatch(w, new Set(['c:food']))).toBeCloseTo(0.3, 10);
  });
  it('the spec thresholds decide the action', () => {
    const user = { preferences: { feature_weights: { likes: { 'k:x': 3 }, dislikes: {} } }, taste_profile: { consistency: 1, love_rate: 0 } };
    const r = simulateInteraction(user, new Set(['k:x']), () => 0.5);
    expect(r.skip).toBe(false);
    expect(r.rating).toBeGreaterThanOrEqual(4);
  });
});

describe('ncf diagnostics', () => {
  it('textbook BPR on logits trains and lowers the loss', async () => {
    const pos = [];
    const of = [];
    for (let u = 0; u < 20; u++) {
      const s = new Set([u % 5, (u % 5) + 5]);
      of.push(s);
      for (const i of s) pos.push(u, i);
    }
    const m = new NCFModel({ bpr_on: 'logit', epochs: 8, early_stopping_patience: 50 }).init(20, 12);
    const run = await m.train({ positives: Int32Array.from(pos), positivesOf: of, valTriples: new Int32Array(0) });
    expect(run.history.at(-1).trainLoss).toBeLessThan(run.history[0].trainLoss);
  });
});

describe('early stopping on validation accuracy', () => {
  it('keeps the epoch with the best validation accuracy, not the lowest loss', async () => {
    const pos = [];
    const of = [];
    for (let u = 0; u < 30; u++) {
      const s = new Set([u % 6, (u % 6) + 6]);
      of.push(s);
      for (const i of s) pos.push(u, i);
    }
    const val = [];
    for (let u = 0; u < 30; u++) val.push(u, u % 6, 12 + (u % 4));
    const m = new NCFModel({ bpr_on: 'logit', early_stopping_on: 'accuracy', epochs: 10, early_stopping_patience: 50 }).init(30, 16);
    const run = await m.train({ positives: Int32Array.from(pos), positivesOf: of, valTriples: Int32Array.from(val) });
    const bestAcc = Math.max(...run.history.map((h) => h.valAccuracy));
    expect(run.history.find((h) => h.epoch === run.bestEpoch).valAccuracy).toBe(bestAcc);
    expect(run.history.findIndex((h) => h.valAccuracy === bestAcc) + 1).toBe(run.bestEpoch);
  });
});

describe('emulator guard', () => {
  it('refuses a non-local Firestore host', () => {
    const prev = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = 'firestore.googleapis.com:443';
    expect(() => emulatorDb()).toThrow(/Refusing/);
    if (prev === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = prev;
  });
  it('returns null with no emulator configured', () => {
    const prev = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(emulatorDb()).toBeNull();
    if (prev !== undefined) process.env.FIRESTORE_EMULATOR_HOST = prev;
  });
});
