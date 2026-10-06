import { NCF as PROD } from '../src/lib/maprRank/config.js';
import { seededRandom } from '../src/lib/maprRank/experiments.js';
import { createModel, serializeModel } from '../src/lib/maprRank/ncf.js';

// The production NCF (src/lib/maprRank/ncf.js), trained faster.
//
// Same network, same parameter layout, same initialisation (createModel),
// same loss, optimizer and update rule as trainModel():
//   user(32) ++ landmark(32) -> 64 -> ReLU -> Dropout(0.2) -> 32 -> ReLU
//   -> Dropout(0.2) -> 1 -> sigmoid
//   BPR: loss = softplus(-(y_pos - y_neg)), plus L2 on touched params
//   Adam lr 0.001, batch 32, lazy per-row Adam on the embeddings
//   5 negatives per positive, uniform over places the user has no positive on
//   early stopping on validation loss, patience 5
// The production loop allocates arrays per pair, which is fine for the
// nightly job's few hundred users and far too slow for 400k positives x 50
// epochs x 30 runs. This loop preallocates everything. test/ncf-model.test.js
// checks it against the production code: same scores for the same weights,
// and the same weights after the same training steps.

const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const softplus = (x) => (x > 30 ? x : Math.log1p(Math.exp(x)));
const B1 = 0.9;
const B2 = 0.999;
const EPS = 1e-8;
const FTZ = 1e-250;

export const DEFAULT_CONFIG = {
  embedding_dim: PROD.embeddingDim,
  mlp_layers: PROD.hidden,
  learning_rate: PROD.learningRate,
  batch_size: PROD.batchSize,
  epochs: PROD.epochs,
  early_stopping_patience: PROD.patience,
  dropout: PROD.dropout,
  l2: PROD.l2,
  negatives_per_positive: PROD.negativesPerPositive,
  loss_fn: 'bpr',
  // Diagnostics only (experiments.js); production is 'probability' / 'catalog'.
  //   bpr_on 'probability'  softplus(-(sigmoid(z_i) - sigmoid(z_j)))   production
  //          'logit'        softplus(-(z_i - z_j))                      textbook BPR
  //   negative_sampling 'catalog'  any place with an embedding        production
  //                     'area'     places in the user's own area
  bpr_on: 'probability',
  negative_sampling: 'catalog',
  seed: PROD.seed,
};

export class NCFModel {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    if (this.cfg.loss_fn !== 'bpr') throw new Error('only BPR is implemented (production uses BPR)');
    if (this.cfg.mlp_layers.length !== 2) throw new Error('the production network has two hidden layers');
  }

  // numUsers/numItems: index space. Uses production createModel so the
  // starting weights are bit-identical to what the nightly job would start from.
  init(numUsers, numItems) {
    const c = this.cfg;
    this.model = createModel({ numUsers, numItems, dim: c.embedding_dim, hidden: c.mlp_layers, seed: c.seed });
    const m = this.model;
    const d = m.dim;
    const [h1, h2] = c.mlp_layers;
    this.d = d;
    this.h1 = h1;
    this.h2 = h2;
    // Adam state, laid out like production createAdam.
    this.opt = {
      t: 0,
      layers: m.layers.map((l) => ({ mW: new Float64Array(l.W.length), vW: new Float64Array(l.W.length), mb: new Float64Array(l.b.length), vb: new Float64Array(l.b.length) })),
      U: { m: new Float64Array(m.U.length), v: new Float64Array(m.U.length), t: new Uint32Array(numUsers) },
      I: { m: new Float64Array(m.I.length), v: new Float64Array(m.I.length), t: new Uint32Array(numItems) },
    };
    // Scratch for one pair's forward pass (pos and neg slots) and backward.
    const slot = () => ({ x: new Float64Array(2 * d), a1: new Float64Array(h1), m1: new Float64Array(h1), a2: new Float64Array(h2), m2: new Float64Array(h2), y: 0 });
    this.pos = slot();
    this.neg = slot();
    this.d1 = new Float64Array(h1);
    this.d2 = new Float64Array(h2);
    this.dx = new Float64Array(2 * d);
    this.g = m.layers.map((l) => ({ W: new Float64Array(l.W.length), b: new Float64Array(l.b.length) }));
    const B = c.batch_size;
    // Embedding rows touched in a batch: at most 2 per triple per table.
    this.gU = { slotOf: new Int32Array(numUsers).fill(-1), rows: new Int32Array(B), n: 0, buf: new Float64Array(B * d) };
    this.gI = { slotOf: new Int32Array(numItems).fill(-1), rows: new Int32Array(2 * B), n: 0, buf: new Float64Array(2 * B * d) };
    return this;
  }

  // Forward one (u, i) into scratch slot s. drop: apply inverted dropout.
  forward(u, i, s, rng = null) {
    const m = this.model;
    const d = this.d;
    const { x, a1, m1, a2, m2 } = s;
    const U = m.U;
    const I = m.I;
    const uo = u * d;
    const io = i * d;
    for (let j = 0; j < d; j++) {
      x[j] = U[uo + j];
      x[d + j] = I[io + j];
    }
    const drop = rng ? this.cfg.dropout : 0;
    const keep = 1 - drop;
    const scale = drop > 0 ? 1 / keep : 1;
    const [L0, L1, L2] = m.layers;
    const n0 = L0.in;
    const W0 = L0.W;
    const b0 = L0.b;
    for (let o = 0; o < this.h1; o++) {
      let z = b0[o];
      const row = o * n0;
      for (let j = 0; j < n0; j++) z += W0[row + j] * x[j];
      const on = z > 0 && (drop <= 0 || rng() < keep);
      const mk = on ? scale : 0;
      m1[o] = mk;
      a1[o] = z > 0 ? z * mk : 0;
    }
    const n1 = this.h1;
    const W1 = L1.W;
    const b1 = L1.b;
    for (let o = 0; o < this.h2; o++) {
      let z = b1[o];
      const row = o * n1;
      for (let j = 0; j < n1; j++) z += W1[row + j] * a1[j];
      const on = z > 0 && (drop <= 0 || rng() < keep);
      const mk = on ? scale : 0;
      m2[o] = mk;
      a2[o] = z > 0 ? z * mk : 0;
    }
    let z = L2.b[0];
    const W2 = L2.W;
    for (let j = 0; j < this.h2; j++) z += W2[j] * a2[j];
    s.z = z;
    s.y = sigmoid(z);
    return s.y;
  }

  _embedGrad(table, row) {
    let k = table.slotOf[row];
    if (k < 0) {
      k = table.n++;
      table.slotOf[row] = k;
      table.rows[k] = row;
      table.buf.fill(0, k * this.d, k * this.d + this.d);
    }
    return k * this.d;
  }

  // Adds dLoss/dparams for the pair in slot s, given dLoss/dy (or dLoss/dz
  // with onLogit).
  backward(u, i, s, dy, onLogit = false) {
    const m = this.model;
    const [L0, L1, L2] = m.layers;
    const [g0, g1, g2] = this.g;
    const { x, a1, m1, a2, m2, y } = s;
    const dz = onLogit ? dy : dy * y * (1 - y);
    const d2 = this.d2;
    const d1 = this.d1;
    const dx = this.dx;
    g2.b[0] += dz;
    for (let j = 0; j < this.h2; j++) {
      g2.W[j] += dz * a2[j];
      d2[j] = L2.W[j] * dz * m2[j];
    }
    const n1 = this.h1;
    d1.fill(0);
    for (let o = 0; o < this.h2; o++) {
      const dd = d2[o];
      if (dd === 0) continue;
      g1.b[o] += dd;
      const row = o * n1;
      for (let j = 0; j < n1; j++) {
        g1.W[row + j] += dd * a1[j];
        d1[j] += L1.W[row + j] * dd;
      }
    }
    for (let j = 0; j < n1; j++) d1[j] *= m1[j];
    const n0 = L0.in;
    dx.fill(0);
    for (let o = 0; o < this.h1; o++) {
      const dd = d1[o];
      if (dd === 0) continue;
      g0.b[o] += dd;
      const row = o * n0;
      for (let j = 0; j < n0; j++) {
        g0.W[row + j] += dd * x[j];
        dx[j] += L0.W[row + j] * dd;
      }
    }
    const d = this.d;
    const uo = this._embedGrad(this.gU, u);
    const io = this._embedGrad(this.gI, i);
    const bu = this.gU.buf;
    const bi = this.gI.buf;
    for (let j = 0; j < d; j++) {
      bu[uo + j] += dx[j];
      bi[io + j] += dx[d + j];
    }
  }

  // Flush-to-zero: production's BPR on sigmoid outputs saturates the output
  // unit (logits reach -50 within a few epochs), so many gradients become
  // ~1e-24 and Adam's moments then decay through the subnormal float range,
  // where every multiply is far slower on x86. Values under FTZ are replaced
  // by 0. Nothing that size changes a weight in any printed digit; it keeps
  // an epoch at ~6 s instead of ~27 s. The production nightly job has the
  // same slowdown inside its 30 s budget.
  _adam(params, grads, mArr, vArr, t, lr, offset, n, gOffset = 0) {
    const c1 = 1 - B1 ** t;
    const c2 = 1 - B2 ** t;
    for (let k = 0; k < n; k++) {
      const p = offset + k;
      const gk = grads[gOffset + k];
      let mk = B1 * mArr[p] + (1 - B1) * gk;
      let vk = B2 * vArr[p] + (1 - B2) * gk * gk;
      if (mk < FTZ && mk > -FTZ) mk = 0;
      if (vk < FTZ) vk = 0;
      mArr[p] = mk;
      vArr[p] = vk;
      const next = params[p] - (lr * (mk / c1)) / (Math.sqrt(vk / c2) + EPS);
      params[p] = next < FTZ && next > -FTZ ? 0 : next;
    }
  }

  // Same order of operations as production applyGrads.
  step(batchSize) {
    const m = this.model;
    const { learning_rate: lr, l2 } = this.cfg;
    const opt = this.opt;
    opt.t += 1;
    const scale = 1 / batchSize;
    m.layers.forEach((layer, k) => {
      const gW = this.g[k].W;
      const gb = this.g[k].b;
      for (let j = 0; j < gW.length; j++) gW[j] = gW[j] * scale + l2 * layer.W[j];
      for (let j = 0; j < gb.length; j++) gb[j] *= scale;
      this._adam(layer.W, gW, opt.layers[k].mW, opt.layers[k].vW, opt.t, lr, 0, gW.length);
      this._adam(layer.b, gb, opt.layers[k].mb, opt.layers[k].vb, opt.t, lr, 0, gb.length);
      gW.fill(0);
      gb.fill(0);
    });
    const d = this.d;
    for (const [table, g, state] of [[m.U, this.gU, opt.U], [m.I, this.gI, opt.I]]) {
      for (let k = 0; k < g.n; k++) {
        const row = g.rows[k];
        const off = row * d;
        const go = k * d;
        for (let j = 0; j < d; j++) g.buf[go + j] = g.buf[go + j] * scale + l2 * table[off + j];
        state.t[row] += 1;
        this._adam(table, g.buf, state.m, state.v, state.t[row], lr, off, d, go);
        g.slotOf[row] = -1;
      }
      g.n = 0;
    }
  }

  score(u, i) {
    return this.forward(u, i, this.pos, null);
  }

  // BPR loss and pairwise accuracy of fixed triples, no dropout.
  evaluateTriples(triples) {
    const n = triples.length / 3;
    if (!n) return { loss: NaN, accuracy: null };
    let loss = 0;
    let hits = 0;
    const logit = this.cfg.bpr_on === 'logit';
    for (let t = 0; t < n; t++) {
      const u = triples[3 * t];
      const yi = this.forward(u, triples[3 * t + 1], this.pos, null);
      const yj = this.forward(u, triples[3 * t + 2], this.neg, null);
      loss += softplus(logit ? -(this.pos.z - this.neg.z) : -(yi - yj));
      if (yi > yj) hits++;
    }
    return { loss: loss / n, accuracy: hits / n };
  }

  // positives: Int32Array of [u, i, u, i, ...] (unique pairs).
  // positivesOf: Array(numUsers) of Set<item> (all of the user's positives,
  // so negatives never hit a known positive). negativePool(u): optional,
  // the item list negatives come from (production: every item).
  // valTriples: Int32Array [u, i, j, ...] for early stopping.
  // onEpoch({ epoch, trainLoss, valLoss, valAccuracy, ms }) after each epoch.
  async train({ positives, positivesOf, valTriples, negativePool = null, onEpoch = null, yieldEvery = 0 }) {
    const c = this.cfg;
    const logit = c.bpr_on === 'logit';
    const rng = seededRandom(c.seed + 1);
    const m = this.model;
    const nPos = positives.length / 2;
    const k = c.negatives_per_positive;
    const triples = new Int32Array(nPos * k * 3);
    const order = new Uint32Array(nPos * k);
    let best = null;
    let bestLoss = Infinity;
    let bestEpoch = 0;
    let sinceBest = 0;
    let stoppedBy = 'epochs';
    const history = [];
    const started = Date.now();
    for (let epoch = 1; epoch <= c.epochs; epoch++) {
      const t0 = Date.now();
      // Negatives, fresh each epoch (production sampleNegatives).
      let n = 0;
      for (let p = 0; p < nPos; p++) {
        const u = positives[2 * p];
        const i = positives[2 * p + 1];
        const own = positivesOf[u];
        const pool = negativePool ? negativePool(u) : null;
        const size = pool ? pool.length : m.numItems;
        if (own.size >= size) continue;
        for (let q = 0; q < k; q++) {
          let j;
          let guard = 0;
          do {
            const r = Math.floor(rng() * size);
            j = pool ? pool[r] : r;
          } while (own.has(j) && ++guard < 1000);
          if (own.has(j)) continue;
          triples[3 * n] = u;
          triples[3 * n + 1] = i;
          triples[3 * n + 2] = j;
          n++;
        }
      }
      for (let t = 0; t < n; t++) order[t] = t;
      for (let t = n - 1; t > 0; t--) {
        const s = Math.floor(rng() * (t + 1));
        const tmp = order[t];
        order[t] = order[s];
        order[s] = tmp;
      }
      let trainLoss = 0;
      const B = c.batch_size;
      for (let s = 0; s < n; s += B) {
        const end = Math.min(n, s + B);
        for (let q = s; q < end; q++) {
          const o = order[q];
          const u = triples[3 * o];
          const i = triples[3 * o + 1];
          const j = triples[3 * o + 2];
          const yi = this.forward(u, i, this.pos, rng);
          const yj = this.forward(u, j, this.neg, rng);
          const x = logit ? this.pos.z - this.neg.z : yi - yj;
          trainLoss += softplus(-x);
          const dx = sigmoid(x) - 1;
          this.backward(u, i, this.pos, dx, logit);
          this.backward(u, j, this.neg, -dx, logit);
        }
        this.step(end - s);
        if (yieldEvery && (s / B) % yieldEvery === 0) await new Promise((r) => setImmediate(r));
      }
      trainLoss = n ? trainLoss / n : NaN;
      const val = valTriples?.length ? this.evaluateTriples(valTriples) : { loss: trainLoss, accuracy: null };
      const row = { epoch, trainLoss, valLoss: val.loss, valAccuracy: val.accuracy, ms: Date.now() - t0, triples: n };
      history.push(row);
      if (val.loss < bestLoss - 1e-6) {
        bestLoss = val.loss;
        bestEpoch = epoch;
        best = snapshot(m);
        sinceBest = 0;
        row.best = true;
      } else if (++sinceBest >= c.early_stopping_patience) {
        stoppedBy = 'early-stopping';
        onEpoch?.(row);
        break;
      }
      onEpoch?.(row);
    }
    if (best) restore(m, best);
    this.training = { bestEpoch, bestLoss, stoppedBy, history, ms: Date.now() - started };
    return this.training;
  }

  // Fast scorer for ranking many items for one user: the first layer's
  // item half is precomputed once per model (itemPart), the user half once
  // per user, as production prepareScorer does on the phone.
  prepareRanking() {
    const m = this.model;
    const d = this.d;
    const L0 = m.layers[0];
    const n0 = L0.in;
    const itemPart = new Float64Array(m.numItems * this.h1);
    for (let i = 0; i < m.numItems; i++) {
      for (let o = 0; o < this.h1; o++) {
        let s = 0;
        const row = o * n0 + d;
        for (let j = 0; j < d; j++) s += L0.W[row + j] * m.I[i * d + j];
        itemPart[i * this.h1 + o] = s;
      }
    }
    this.itemPart = itemPart;
  }

  // userVec: Float64Array(d) (an embedding row, or a folded-in one).
  scoreItemsFor(userVec, items, out) {
    const m = this.model;
    const d = this.d;
    const [L0, L1, L2] = m.layers;
    const n0 = L0.in;
    const h1 = this.h1;
    const h2 = this.h2;
    const up = new Float64Array(h1);
    for (let o = 0; o < h1; o++) {
      let s = L0.b[o];
      const row = o * n0;
      for (let j = 0; j < d; j++) s += L0.W[row + j] * userVec[j];
      up[o] = s;
    }
    const a1 = new Float64Array(h1);
    for (let t = 0; t < items.length; t++) {
      const ip = items[t] * h1;
      for (let o = 0; o < h1; o++) {
        const z = up[o] + this.itemPart[ip + o];
        a1[o] = z > 0 ? z : 0;
      }
      let z3 = L2.b[0];
      for (let o = 0; o < h2; o++) {
        let z = L1.b[o];
        const row = o * h1;
        for (let j = 0; j < h1; j++) z += L1.W[row + j] * a1[j];
        if (z > 0) z3 += L2.W[o] * z;
      }
      out[t] = sigmoid(z3);
    }
    return out;
  }

  userVector(u) {
    return this.model.U.subarray(u * this.d, u * this.d + this.d);
  }

  // Cold start: a user the model never saw gets an embedding fitted to a few
  // positives with the network and landmark embeddings frozen (BPR, plain
  // SGD on the 32 user numbers only). Production has no fold-in today: an
  // unseen user falls back to the base score until the weekly retrain.
  foldIn(positiveItems, negativePool, { steps = 200, lr = 0.05, seed = 1, exclude = null } = {}) {
    const d = this.d;
    const vec = new Float64Array(d);
    if (!positiveItems.length) return vec;
    const rng = seededRandom(seed);
    const m = this.model;
    const saveRow = Float64Array.from(m.U.subarray(0, d));
    const own = exclude || new Set(positiveItems);
    for (let s = 0; s < steps; s++) {
      const i = positiveItems[Math.floor(rng() * positiveItems.length)];
      let j;
      let guard = 0;
      do j = negativePool[Math.floor(rng() * negativePool.length)];
      while (own.has(j) && ++guard < 100);
      // Borrow user row 0 as scratch so forward/backward can be reused.
      m.U.set(vec, 0);
      const yi = this.forward(0, i, this.pos, null);
      const yj = this.forward(0, j, this.neg, null);
      const logit = this.cfg.bpr_on === 'logit';
      const dxv = sigmoid(logit ? this.pos.z - this.neg.z : yi - yj) - 1;
      const grad = new Float64Array(d);
      for (const [slot, dy] of [[this.pos, dxv], [this.neg, -dxv]]) {
        this._inputGrad(slot, dy, logit);
        for (let q = 0; q < d; q++) grad[q] += this.dx[q];
      }
      for (let q = 0; q < d; q++) vec[q] -= lr * (grad[q] + this.cfg.l2 * vec[q]);
    }
    m.U.set(saveRow, 0);
    return vec;
  }

  // dLoss/dinput for the pair in slot s (no parameter gradients).
  _inputGrad(s, dy, onLogit = false) {
    const [L0, L1, L2] = this.model.layers;
    const { m1, m2, y } = s;
    const dz = onLogit ? dy : dy * y * (1 - y);
    const d2 = this.d2;
    const d1 = this.d1;
    const dx = this.dx;
    for (let j = 0; j < this.h2; j++) d2[j] = L2.W[j] * dz * m2[j];
    d1.fill(0);
    const n1 = this.h1;
    for (let o = 0; o < this.h2; o++) {
      const dd = d2[o];
      if (dd === 0) continue;
      const row = o * n1;
      for (let j = 0; j < n1; j++) d1[j] += L1.W[row + j] * dd;
    }
    for (let j = 0; j < n1; j++) d1[j] *= m1[j];
    dx.fill(0);
    const n0 = L0.in;
    for (let o = 0; o < this.h1; o++) {
      const dd = d1[o];
      if (dd === 0) continue;
      const row = o * n0;
      for (let j = 0; j < this.d; j++) dx[j] += L0.W[row + j] * dd;
    }
  }

  // The production storage format (serializeModel): shared part (MLP +
  // landmark embeddings keyed by place id) and per-user embeddings.
  export({ users, items, meta = {} }) {
    const index = { users, items };
    return serializeModel({ model: this.model, index }, { meta: { ...meta, config: this.cfg } });
  }
}

function snapshot(m) {
  return { U: Float64Array.from(m.U), I: Float64Array.from(m.I), layers: m.layers.map((l) => ({ W: Float64Array.from(l.W), b: Float64Array.from(l.b) })) };
}

function restore(m, s) {
  m.U.set(s.U);
  m.I.set(s.I);
  m.layers.forEach((l, k) => {
    l.W.set(s.layers[k].W);
    l.b.set(s.layers[k].b);
  });
}
