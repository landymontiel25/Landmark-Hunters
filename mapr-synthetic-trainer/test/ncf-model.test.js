import { describe, expect, it } from 'vitest';
import { _internals, createModel, scorePair, trainModel } from '../../src/lib/maprRank/ncf.js';
import { NCF } from '../../src/lib/maprRank/config.js';
import { NCFModel } from '../ncf-model.js';

// The fast trainer must be the production model, not a lookalike.

function toyData(numUsers, numItems, perUser, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pairs = [];
  const positivesOf = new Map();
  for (let u = 0; u < numUsers; u++) {
    const own = new Set();
    while (own.size < perUser) own.add(Math.floor(rnd() * numItems));
    positivesOf.set(u, own);
    for (const i of own) pairs.push([u, i]);
  }
  return { pairs, positivesOf };
}

describe('NCFModel matches production ncf.js', () => {
  it('scores the same as production scorePair for the same weights', () => {
    const fast = new NCFModel().init(5, 9);
    const prod = createModel({ numUsers: 5, numItems: 9 });
    for (let u = 0; u < 5; u++) for (let i = 0; i < 9; i++) expect(fast.score(u, i)).toBe(scorePair(prod, u, i));
  });

  it('ends with bit-identical weights after the same training run', async () => {
    const { pairs, positivesOf } = toyData(12, 30, 4);
    const cfg = { ...NCF, epochs: 3, patience: 10 };
    const prod = trainModel({ model: createModel({ numUsers: 12, numItems: 30 }), trainPairs: pairs, positivesOf, valTriples: [[0, [...positivesOf.get(0)][0], 29]], cfg });
    const fast = new NCFModel({ epochs: 3, early_stopping_patience: 10 }).init(12, 30);
    const posArr = Int32Array.from(pairs.flat());
    const ofArr = Array.from({ length: 12 }, (_, u) => positivesOf.get(u));
    const run = await fast.train({ positives: posArr, positivesOf: ofArr, valTriples: Int32Array.from([0, [...positivesOf.get(0)][0], 29]) });
    expect(run.history.map((h) => h.trainLoss)).toEqual(prod.history.map((h) => h.trainLoss));
    expect(Array.from(fast.model.U)).toEqual(Array.from(prod.model.U));
    expect(Array.from(fast.model.I)).toEqual(Array.from(prod.model.I));
    fast.model.layers.forEach((l, k) => expect(Array.from(l.W)).toEqual(Array.from(prod.model.layers[k].W)));
  });

  it('ranking scorer equals the pair scorer', () => {
    const fast = new NCFModel().init(3, 7);
    fast.prepareRanking();
    const out = new Float64Array(7);
    fast.scoreItemsFor(fast.userVector(2), [0, 1, 2, 3, 4, 5, 6], out);
    for (let i = 0; i < 7; i++) expect(out[i]).toBeCloseTo(fast.score(2, i), 12);
  });

  it('exports in the production storage format', () => {
    const fast = new NCFModel().init(2, 3);
    const out = fast.export({ users: ['a', 'b'], items: ['x', 'y', 'z'] });
    expect(Object.keys(out.shared.items)).toEqual(['x', 'y', 'z']);
    expect(out.shared.layers.map((l) => [l.in, l.out])).toEqual([[64, 64], [64, 32], [32, 1]]);
    expect(out.users.a).toHaveLength(32);
  });

  it('_internals stay available for the gradient check', () => {
    expect(typeof _internals.forwardPair).toBe('function');
  });
});
