import { describe, it, expect } from 'vitest';
import {
  _internals,
  bprLoss,
  buildIndex,
  createModel,
  hasDrifted,
  pairwiseAccuracy,
  prepareScorer,
  sampleNegatives,
  scorePair,
  serializeModel,
  shouldPromote,
  temporalSplit,
  trainModel,
  ncfFromDoc,
  regionPools,
  trainNcf,
} from './ncf.js';
import { NCF, NCF_V2 } from './config.js';
import { seededRandom } from './experiments.js';

const { forwardPair, backwardPair, zeroGrads, softplus, sigmoid } = _internals;
const DAY = 86400000;
const NOW = Date.parse('2026-10-01T00:00:00Z');

// Users who like "their" cluster of items: user u visits items in cluster u % C.
function clusteredData({ users = 30, items = 40, clusters = 4, perUser = 6, seed = 3 } = {}) {
  const rng = seededRandom(seed);
  const positives = [];
  for (let u = 0; u < users; u++) {
    const c = u % clusters;
    const pool = Array.from({ length: items }, (_, i) => i).filter((i) => i % clusters === c);
    for (let k = 0; k < perUser; k++) {
      const i = pool[Math.floor(rng() * pool.length)];
      positives.push({ userId: `u${u}`, itemKey: `r/i${i}`, at: NOW - Math.floor(rng() * 89 * DAY) - 1000 });
    }
  }
  return positives;
}

describe('NCF architecture', () => {
  it('has 32-d embeddings and a 64 -> 64 -> 32 -> 1 MLP', () => {
    const m = createModel({ numUsers: 3, numItems: 5 });
    expect(m.U.length).toBe(3 * 32);
    expect(m.I.length).toBe(5 * 32);
    expect(m.layers.map((l) => [l.in, l.out])).toEqual([
      [64, 64],
      [64, 32],
      [32, 1],
    ]);
  });

  it('initializes embeddings and weights in a reasonable range', () => {
    const m = createModel({ numUsers: 50, numItems: 50 });
    const emb = [...m.U, ...m.I];
    const mean = emb.reduce((a, b) => a + b, 0) / emb.length;
    const sd = Math.sqrt(emb.reduce((a, b) => a + (b - mean) ** 2, 0) / emb.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(0.05);
    expect(sd).toBeLessThan(0.15);
    for (const l of m.layers) for (const w of l.W) expect(Math.abs(w)).toBeLessThanOrEqual(1 / Math.sqrt(l.in));
  });

  it('outputs one score in [0, 1] per pair', () => {
    const m = createModel({ numUsers: 4, numItems: 6 });
    for (let u = 0; u < 4; u++)
      for (let i = 0; i < 6; i++) {
        const y = scorePair(m, u, i);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
  });

  it('backpropagates the exact gradient (numerical check)', () => {
    const m = createModel({ numUsers: 2, numItems: 3, dim: 4, hidden: [5, 3], seed: 11 });
    const loss = () => softplus(-(forwardPair(m, 0, 1).y - forwardPair(m, 0, 2).y));
    const g = zeroGrads(m);
    const pos = forwardPair(m, 0, 1);
    const neg = forwardPair(m, 0, 2);
    const dx = sigmoid(pos.y - neg.y) - 1;
    backwardPair(m, 0, 1, pos, dx, g);
    backwardPair(m, 0, 2, neg, -dx, g);
    const h = 1e-6;
    const check = (arr, idx, analytic) => {
      const keep = arr[idx];
      arr[idx] = keep + h;
      const up = loss();
      arr[idx] = keep - h;
      const down = loss();
      arr[idx] = keep;
      const numeric = (up - down) / (2 * h);
      expect(Math.abs(numeric - analytic)).toBeLessThan(1e-6 + 1e-4 * Math.abs(numeric));
    };
    for (let k = 0; k < m.layers.length; k++) {
      for (const idx of [0, 1, m.layers[k].W.length - 1]) check(m.layers[k].W, idx, g.layers[k].W[idx]);
      check(m.layers[k].b, 0, g.layers[k].b[0]);
    }
    for (let j = 0; j < 4; j++) {
      check(m.U, j, g.U.get(0)[j]);
      check(m.I, 4 + j, g.I.get(1)[j]);
      check(m.I, 8 + j, g.I.get(2)[j]);
    }
  });
});

describe('data', () => {
  it('splits the 90-day window by time: 70 / 15 / 15', () => {
    const mk = (days) => ({ userId: 'u', itemKey: 'x', at: NOW - days * DAY });
    const s = temporalSplit([mk(89), mk(30), mk(20), mk(12), mk(1), mk(100)], { now: NOW });
    // train: before day 27 from now; val: days 27..13.5; test: last 13.5 days
    expect(s.train.map((p) => Math.round((NOW - p.at) / DAY))).toEqual([89, 30]);
    expect(s.val.map((p) => Math.round((NOW - p.at) / DAY))).toEqual([20]);
    expect(s.test.map((p) => Math.round((NOW - p.at) / DAY))).toEqual([12, 1]);
  });

  it('never samples a user\'s own positive as a negative, and samples 5 per positive', () => {
    const rng = seededRandom(9);
    const pos = new Map([[0, new Set([0, 1, 2])]]);
    const t = sampleNegatives([[0, 0], [0, 1]], pos, 10, 5, rng);
    expect(t).toHaveLength(10);
    for (const [, , j] of t) expect(pos.get(0).has(j)).toBe(false);
  });

  it('samples negatives roughly uniformly', () => {
    const rng = seededRandom(4);
    const t = sampleNegatives(Array.from({ length: 2000 }, () => [0, 0]), new Map([[0, new Set([0])]]), 5, 5, rng);
    const counts = [0, 0, 0, 0, 0];
    for (const [, , j] of t) counts[j]++;
    expect(counts[0]).toBe(0);
    for (const c of counts.slice(1)) expect(c / t.length).toBeGreaterThan(0.22);
  });

  it('skips a user who has every item', () => {
    expect(sampleNegatives([[0, 0]], new Map([[0, new Set([0, 1])]]), 2, 5, Math.random)).toEqual([]);
  });

  it('indexes the most-visited items first', () => {
    const idx = buildIndex([{ userId: 'a', itemKey: 'x' }, { userId: 'b', itemKey: 'y' }, { userId: 'c', itemKey: 'y' }]);
    expect(idx.items).toEqual(['y', 'x']);
    expect(idx.users).toEqual(['a', 'b', 'c']);
  });
});

describe('training', () => {
  it('lowers BPR loss over epochs on 100 examples', () => {
    const pos = clusteredData({ users: 20, items: 20, perUser: 5 }).slice(0, 100);
    const index = buildIndex(pos);
    const pairs = _internals.indexPairs(pos, index);
    const positivesOf = new Map();
    for (const [u, i] of pairs) (positivesOf.get(u) || positivesOf.set(u, new Set()).get(u)).add(i);
    const model = createModel({ numUsers: index.users.length, numItems: index.items.length });
    const fixed = sampleNegatives(pairs, positivesOf, index.items.length, 5, seededRandom(1));
    const before = bprLoss(model, fixed);
    const run = trainModel({ model, trainPairs: pairs, positivesOf, cfg: { ...NCF, learningRate: 0.01 }, maxEpochs: 15 });
    expect(bprLoss(run.model, fixed)).toBeLessThan(before);
    expect(run.history[run.history.length - 1].trainLoss).toBeLessThan(run.history[0].trainLoss);
  });

  it('learns the clusters: holdout pairwise accuracy well above chance', () => {
    const result = trainNcf(clusteredData({ users: 40, items: 40, perUser: 10 }), { now: NOW, cfg: { ...NCF, learningRate: 0.01 }, budgetMs: 60_000 });
    expect(result.ok).toBe(true);
    expect(result.evaluation.testAccuracy).toBeGreaterThan(0.7);
    expect(result.evaluation.bestEpoch).toBeGreaterThan(0);
  });

  it('stops early when validation loss stops improving (patience 5)', () => {
    const result = trainNcf(clusteredData({ users: 30, items: 24, perUser: 8 }), { now: NOW, cfg: { ...NCF, learningRate: 0.05 }, refit: false, budgetMs: 60_000 });
    const { history, bestEpoch, stoppedBy } = result.evaluation;
    if (stoppedBy === 'early-stopping') expect(history.length).toBe(bestEpoch + NCF.patience);
    else expect(history.length).toBeLessThanOrEqual(NCF.epochs);
  });

  it('trains on 1000 training examples in well under 5 minutes', () => {
    const pos = clusteredData({ users: 100, items: 80, perUser: 10 });
    const t0 = Date.now();
    const r = trainNcf(pos, { now: NOW, budgetMs: 5 * 60 * 1000 });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5 * 60 * 1000);
  }, 300_000);

  it('stops at the time budget', () => {
    const r = trainNcf(clusteredData({ users: 100, items: 80, perUser: 10 }), { now: NOW, budgetMs: 50 });
    expect(r.evaluation.stoppedBy).toBe('time-budget');
  });

  it('reports not-enough-data instead of training on nothing', () => {
    expect(trainNcf([], { now: NOW })).toMatchObject({ ok: false, reason: 'not-enough-data' });
  });
});

describe('serving', () => {
  const result = trainNcf(clusteredData({ users: 20, items: 30, perUser: 6 }), { now: NOW, budgetMs: 20_000 });
  const { shared, users } = serializeModel(result, { meta: { version: 'v1' } });

  it('the on-device scorer matches the trainer within storage rounding', () => {
    const uid = result.index.users[0];
    const scorer = prepareScorer(JSON.parse(JSON.stringify(shared)), users[uid]);
    for (const [n, key] of result.index.items.entries()) {
      expect(scorer.score(key)).toBeCloseTo(scorePair(result.model, 0, n), 2);
    }
    expect(scorer.score('not/known')).toBeNull();
  });

  it('scores 100 landmarks in under 10 ms (well under 1 ms each)', () => {
    const big = createModel({ numUsers: 1, numItems: 100 });
    const ser = serializeModel({ model: big, index: { users: ['u'], items: Array.from({ length: 100 }, (_, i) => `r/${i}`) } });
    const scorer = prepareScorer(ser.shared, ser.users.u);
    for (let i = 0; i < 100; i++) scorer.score(`r/${i}`); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) scorer.score(`r/${i}`);
    expect(performance.now() - t0).toBeLessThan(10);
  });

  it('refuses a malformed model or embedding (fallback trigger)', () => {
    expect(prepareScorer(null, users[result.index.users[0]])).toBeNull();
    expect(prepareScorer(shared, [1, 2, 3])).toBeNull();
    expect(prepareScorer({ ...shared, layers: [{ in: 1, out: 1, W: [1], b: [0] }] }, users[result.index.users[0]])).toBeNull();
    expect(prepareScorer({ ...shared, layers: shared.layers.map((l, k) => (k === 1 ? { ...l, W: l.W.slice(1) } : l)) }, users[result.index.users[0]])).toBeNull();
  });

  it('keeps model weights small: 32 x (users + landmarks) floats plus the MLP', () => {
    expect(Object.values(shared.items).every((e) => e.length === 32)).toBe(true);
    expect(Object.values(users).every((e) => e.length === 32)).toBe(true);
  });
});

describe('promotion and drift', () => {
  it('promotes unless accuracy drops more than 5%', () => {
    expect(shouldPromote(0.8, 0.8)).toBe(true);
    expect(shouldPromote(0.77, 0.8)).toBe(true);
    expect(shouldPromote(0.75, 0.8)).toBe(false);
    expect(shouldPromote(0.6, null)).toBe(true);
    expect(shouldPromote(null, 0.8)).toBe(false);
  });

  it('flags drift past a 10% drop', () => {
    expect(hasDrifted(0.7, 0.8)).toBe(true);
    expect(hasDrifted(0.75, 0.8)).toBe(false);
    expect(hasDrifted(null, 0.8)).toBe(false);
  });

  it('pairwiseAccuracy is null with nothing to score', () => {
    expect(pairwiseAccuracy(createModel({ numUsers: 1, numItems: 2 }), [])).toBeNull();
  });
});

// Two regions with their own clusters: keys "a/i0".."a/i19" and "b/i0"...
function twoRegionData({ users = 40, perUser = 10, seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const positives = [];
  for (let u = 0; u < users; u++) {
    const region = u % 2 ? 'a' : 'b';
    const c = Math.floor(u / 2) % 2;
    const pool = Array.from({ length: 20 }, (_, i) => i).filter((i) => i % 2 === c);
    for (let k = 0; k < perUser; k++) positives.push({ userId: `u${u}`, itemKey: `${region}/i${pool[Math.floor(rng() * pool.length)]}`, at: NOW - Math.floor(rng() * 89 * DAY) - 1000 });
  }
  return positives;
}

describe('Mapr v2 training (NCF_V2)', () => {
  it('turns on all three fixes and the signed 0.8 / 0.2 blend', () => {
    expect(NCF_V2).toMatchObject({ family: 'v2', modelDoc: 'ncf_v2', bprOn: 'logit', negativeSampling: 'region', earlyStoppingOn: 'accuracy', baseWeight: 0.8, ncfWeight: 0.2, signedBase: true });
    expect(NCF).toMatchObject({ family: 'v1', modelDoc: 'ncf', bprOn: 'probability', negativeSampling: 'catalog', earlyStoppingOn: 'loss', signedBase: false });
  });

  it('lowers BPR loss on logits', () => {
    const pos = clusteredData({ users: 20, items: 20, perUser: 5 }).slice(0, 100);
    const index = buildIndex(pos);
    const pairs = _internals.indexPairs(pos, index);
    const positivesOf = new Map();
    for (const [u, i] of pairs) (positivesOf.get(u) || positivesOf.set(u, new Set()).get(u)).add(i);
    const model = createModel({ numUsers: index.users.length, numItems: index.items.length });
    const fixed = sampleNegatives(pairs, positivesOf, index.items.length, 5, seededRandom(1));
    const before = bprLoss(model, fixed, true);
    const run = trainModel({ model, trainPairs: pairs, positivesOf, cfg: { ...NCF_V2, learningRate: 0.01, earlyStoppingOn: 'loss' }, maxEpochs: 15 });
    expect(bprLoss(run.model, fixed, true)).toBeLessThan(before);
  });

  it('backpropagates the exact gradient of the logit loss (numerical check)', () => {
    const m = createModel({ numUsers: 2, numItems: 3, dim: 4, hidden: [5, 3], seed: 11 });
    const loss = () => softplus(-(forwardPair(m, 0, 1).z - forwardPair(m, 0, 2).z));
    const g = zeroGrads(m);
    const pos = forwardPair(m, 0, 1);
    const neg = forwardPair(m, 0, 2);
    const dx = sigmoid(pos.z - neg.z) - 1;
    backwardPair(m, 0, 1, pos, dx, g, true);
    backwardPair(m, 0, 2, neg, -dx, g, true);
    const h = 1e-6;
    const check = (arr, idx, analytic) => {
      const keep = arr[idx];
      arr[idx] = keep + h;
      const up = loss();
      arr[idx] = keep - h;
      const down = loss();
      arr[idx] = keep;
      const numeric = (up - down) / (2 * h);
      expect(Math.abs(numeric - analytic)).toBeLessThan(1e-6 + 1e-4 * Math.abs(numeric));
    };
    for (let k = 0; k < m.layers.length; k++) {
      for (const idx of [0, 1, m.layers[k].W.length - 1]) check(m.layers[k].W, idx, g.layers[k].W[idx]);
      check(m.layers[k].b, 0, g.layers[k].b[0]);
    }
    for (let j = 0; j < 4; j++) check(m.U, j, g.U.get(0)[j]);
  });

  it('draws negatives from the positive\'s own region', () => {
    const items = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'b/1', 'b/2', 'b/3', 'b/4', 'b/5', 'b/6'];
    const poolOf = regionPools(items);
    const triples = sampleNegatives([[0, 0], [0, 7]], new Map([[0, new Set([0, 7])]]), items.length, 50, seededRandom(2), poolOf);
    expect(triples.length).toBe(100);
    for (const [, i, j] of triples) expect(items[j].split('/')[0]).toBe(items[i].split('/')[0]);
  });

  it('falls back to every place for a region under 5 places', () => {
    const poolOf = regionPools(['a/1', 'a/2', 'b/1', 'b/2', 'b/3', 'b/4', 'b/5']);
    expect(poolOf(0)).toBeNull();
    expect(poolOf(2)).toEqual([2, 3, 4, 5, 6]);
  });

  it('keeps the epoch with the best validation accuracy', () => {
    const r = trainNcf(twoRegionData(), { now: NOW, cfg: { ...NCF_V2, learningRate: 0.01 }, refit: false, budgetMs: 60_000 });
    expect(r.ok).toBe(true);
    const { history, bestEpoch } = r.evaluation;
    const best = Math.max(...history.map((h) => h.valAccuracy));
    expect(history[bestEpoch - 1].valAccuracy).toBe(best);
    expect(history.findIndex((h) => h.valAccuracy === best)).toBe(bestEpoch - 1);
    expect(r.evaluation).toMatchObject({ family: 'v2', earlyStoppingOn: 'accuracy' });
    expect(r.evaluation.testAccuracyRegion).toBe(r.evaluation.testAccuracy);
    expect(r.evaluation.testAccuracyCatalog).toBeGreaterThan(0.5);
  });

  it('reports v1 against both kinds of negatives without changing its own test', () => {
    const pos = twoRegionData();
    const a = trainNcf(pos, { now: NOW, cfg: { ...NCF, learningRate: 0.01 }, refit: false, budgetMs: 60_000 });
    expect(a.evaluation.testAccuracyCatalog).toBe(a.evaluation.testAccuracy);
    expect(a.evaluation.testAccuracyRegion).toBeGreaterThan(0);
    expect(a.evaluation.history.every((h) => !('valAccuracy' in h))).toBe(true);
  });

  it('reads a published model doc with its family', () => {
    const doc = { dim: 4, layers: [], items: [], version: 'v2-1', family: 'v2', active: true };
    expect(ncfFromDoc(doc)).toMatchObject({ family: 'v2', version: 'v2-1', active: true });
    expect(ncfFromDoc({ ...doc, family: undefined }).family).toBe('v1');
    expect(ncfFromDoc(null)).toBeNull();
    expect(ncfFromDoc({ dim: 4 })).toBeNull();
  });
});
