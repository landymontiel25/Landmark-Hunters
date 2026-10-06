import { NCF as CFG } from './config.js';
import { seededRandom } from './experiments.js';

// Week 3: Neural Collaborative Filtering, in plain JS so it trains inside
// the nightly Vercel job and scores on the phone with no extra runtime.
// Same architecture as the spec's PyTorch module:
//
//   user_embed[u] (32) ++ landmark_embed[i] (32) -> Linear(64,64) -> ReLU
//   -> Dropout(0.2) -> Linear(64,32) -> ReLU -> Dropout(0.2) -> Linear(32,1)
//   -> Sigmoid
//
// Trained on implicit feedback with BPR: for (u, positive i, negative j),
//   loss = -log(sigmoid(score(u,i) - score(u,j))) + L2
// Adam (lr 0.001), batch 32, up to 50 epochs, early stopping on validation
// loss (patience 5). Embeddings are updated lazily (only rows in the batch).
// v1 (config NCF) uses score = the sigmoid output. v2 (config NCF_V2) uses the
// logit, samples negatives from the positive's own region and stops on
// validation ranking accuracy; see config.js for why.

const DAY_MS = 24 * 60 * 60 * 1000;
const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const softplus = (x) => (x > 30 ? x : Math.log1p(Math.exp(x)));

function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---- Parameters ---------------------------------------------------------------

// layers: [{ W: Float64Array(out*in), b: Float64Array(out), in, out }]
export function createModel({ numUsers, numItems, dim = CFG.embeddingDim, hidden = CFG.hidden, seed = CFG.seed } = {}) {
  const rng = seededRandom(seed);
  const embed = (n) => {
    const a = new Float64Array(n * dim);
    for (let i = 0; i < a.length; i++) a[i] = gaussian(rng) * 0.1;
    return a;
  };
  const sizes = [dim * 2, ...hidden, 1];
  const layers = [];
  for (let k = 0; k < sizes.length - 1; k++) {
    const fanIn = sizes[k];
    const out = sizes[k + 1];
    const bound = 1 / Math.sqrt(fanIn); // PyTorch nn.Linear default range
    const W = new Float64Array(out * fanIn);
    const b = new Float64Array(out);
    for (let i = 0; i < W.length; i++) W[i] = (rng() * 2 - 1) * bound;
    for (let i = 0; i < b.length; i++) b[i] = (rng() * 2 - 1) * bound;
    layers.push({ W, b, in: fanIn, out });
  }
  return { dim, hidden: [...hidden], numUsers, numItems, U: embed(numUsers), I: embed(numItems), layers };
}

function cloneModel(m) {
  return {
    ...m,
    U: Float64Array.from(m.U),
    I: Float64Array.from(m.I),
    layers: m.layers.map((l) => ({ ...l, W: Float64Array.from(l.W), b: Float64Array.from(l.b) })),
  };
}

// ---- Forward / backward -----------------------------------------------------

// One (user, item) pair. With `drop` (rng), applies inverted dropout and
// keeps what backward needs.
function forwardPair(m, u, i, { dropout = 0, rng = null } = {}) {
  const d = m.dim;
  const x = new Float64Array(2 * d);
  x.set(m.U.subarray(u * d, u * d + d), 0);
  x.set(m.I.subarray(i * d, i * d + d), d);
  const acts = [x];
  const masks = [];
  let h = x;
  const last = m.layers.length - 1;
  for (let k = 0; k <= last; k++) {
    const { W, b, out } = m.layers[k];
    const n = h.length;
    const z = new Float64Array(out);
    for (let o = 0; o < out; o++) {
      let s = b[o];
      const row = o * n;
      for (let j = 0; j < n; j++) s += W[row + j] * h[j];
      z[o] = s;
    }
    if (k === last) {
      const y = sigmoid(z[0]);
      return { y, z: z[0], acts, masks };
    }
    const mask = new Float64Array(out);
    const keep = 1 - dropout;
    for (let o = 0; o < out; o++) {
      const on = z[o] > 0 && (!rng || dropout <= 0 || rng() < keep);
      mask[o] = on ? (rng && dropout > 0 ? 1 / keep : 1) : 0;
      z[o] = z[o] > 0 ? z[o] * mask[o] : 0;
    }
    masks.push(mask);
    acts.push(z);
    h = z;
  }
  return { y: NaN, acts, masks };
}

// Adds d(loss)/d(params) for one pair into `g`, given dL/dy (or dL/dz,
// the logit, with onLogit).
function backwardPair(m, u, i, cache, dy, g, onLogit = false) {
  const { y, acts, masks } = cache;
  let delta = new Float64Array([onLogit ? dy : dy * y * (1 - y)]); // through the sigmoid
  for (let k = m.layers.length - 1; k >= 0; k--) {
    const { W, out } = m.layers[k];
    const h = acts[k];
    const n = h.length;
    const gW = g.layers[k].W;
    const gb = g.layers[k].b;
    const prev = new Float64Array(n);
    for (let o = 0; o < out; o++) {
      const dz = delta[o];
      if (dz === 0) continue;
      gb[o] += dz;
      const row = o * n;
      for (let j = 0; j < n; j++) {
        gW[row + j] += dz * h[j];
        prev[j] += W[row + j] * dz;
      }
    }
    if (k > 0) {
      const mask = masks[k - 1];
      for (let j = 0; j < n; j++) prev[j] *= mask[j];
    }
    delta = prev;
  }
  const d = m.dim;
  const gu = g.U.get(u) || g.U.set(u, new Float64Array(d)).get(u);
  const gi = g.I.get(i) || g.I.set(i, new Float64Array(d)).get(i);
  for (let j = 0; j < d; j++) {
    gu[j] += delta[j];
    gi[j] += delta[d + j];
  }
}

const zeroGrads = (m) => ({ U: new Map(), I: new Map(), layers: m.layers.map((l) => ({ W: new Float64Array(l.W.length), b: new Float64Array(l.b.length) })) });

// Score without dropout, 0..1.
export function scorePair(m, u, i) {
  return forwardPair(m, u, i).y;
}

// BPR loss for a list of triples, no dropout, no L2 (validation). onLogit:
// the v2 loss, on the logits.
export function bprLoss(m, triples, onLogit = false) {
  if (!triples.length) return NaN;
  let total = 0;
  for (const [u, i, j] of triples) {
    const a = forwardPair(m, u, i);
    const b = forwardPair(m, u, j);
    total += softplus(onLogit ? -(a.z - b.z) : -(a.y - b.y));
  }
  return total / triples.length;
}

// Share of triples where the positive outscores the negative (pairwise
// accuracy, an AUC estimate). This is the model's "accuracy".
export function pairwiseAccuracy(m, triples) {
  if (!triples.length) return null;
  let hits = 0;
  for (const [u, i, j] of triples) if (scorePair(m, u, i) > scorePair(m, u, j)) hits++;
  return hits / triples.length;
}

// ---- Adam ---------------------------------------------------------------------

function createAdam(m) {
  return {
    t: 0,
    layers: m.layers.map((l) => ({ mW: new Float64Array(l.W.length), vW: new Float64Array(l.W.length), mb: new Float64Array(l.b.length), vb: new Float64Array(l.b.length) })),
    U: { m: new Float64Array(m.U.length), v: new Float64Array(m.U.length), t: new Uint32Array(m.numUsers) },
    I: { m: new Float64Array(m.I.length), v: new Float64Array(m.I.length), t: new Uint32Array(m.numItems) },
  };
}

const B1 = 0.9;
const B2 = 0.999;
const EPS = 1e-8;

// flushTiny: values under FTZ become 0. Vanishing gradients otherwise leave
// Adam's state in the subnormal float range, where every multiply is many
// times slower; nothing that small moves a weight.
const FTZ = 1e-250;
function adamStep(params, grads, mArr, vArr, t, lr, offset = 0, n = params.length, flushTiny = false) {
  const c1 = 1 - B1 ** t;
  const c2 = 1 - B2 ** t;
  for (let k = 0; k < n; k++) {
    const p = offset + k;
    const gk = grads[k];
    mArr[p] = B1 * mArr[p] + (1 - B1) * gk;
    vArr[p] = B2 * vArr[p] + (1 - B2) * gk * gk;
    params[p] -= (lr * (mArr[p] / c1)) / (Math.sqrt(vArr[p] / c2) + EPS);
    if (flushTiny) {
      if (mArr[p] < FTZ && mArr[p] > -FTZ) mArr[p] = 0;
      if (vArr[p] < FTZ) vArr[p] = 0;
      if (params[p] < FTZ && params[p] > -FTZ) params[p] = 0;
    }
  }
}

function applyGrads(m, opt, g, batchSize, { lr, l2, flushTiny = false }) {
  opt.t += 1;
  const scale = 1 / batchSize;
  m.layers.forEach((layer, k) => {
    const gW = g.layers[k].W;
    const gb = g.layers[k].b;
    for (let j = 0; j < gW.length; j++) gW[j] = gW[j] * scale + l2 * layer.W[j];
    for (let j = 0; j < gb.length; j++) gb[j] *= scale;
    adamStep(layer.W, gW, opt.layers[k].mW, opt.layers[k].vW, opt.t, lr, 0, gW.length, flushTiny);
    adamStep(layer.b, gb, opt.layers[k].mb, opt.layers[k].vb, opt.t, lr, 0, gb.length, flushTiny);
  });
  const d = m.dim;
  for (const [table, grads, state] of [[m.U, g.U, opt.U], [m.I, g.I, opt.I]]) {
    for (const [row, gr] of grads) {
      const off = row * d;
      for (let j = 0; j < d; j++) gr[j] = gr[j] * scale + l2 * table[off + j];
      state.t[row] += 1; // lazy Adam: each row keeps its own step count
      adamStep(table, gr, state.m, state.v, state.t[row], lr, off, d, flushTiny);
    }
  }
}

// ---- Data -----------------------------------------------------------------------

// positives: [{ userId, itemKey, at }]. Returns the temporal split of the
// window [now - windowDays, now]: the first 70% of the TIME span trains, the
// next 15% validates, the last 15% is the holdout. A random split would let
// the model see the future.
export function temporalSplit(positives, { now = Date.now(), windowDays = CFG.windowDays, split = CFG.split } = {}) {
  const start = now - windowDays * DAY_MS;
  const trainEnd = start + split.train * (now - start);
  const valEnd = trainEnd + split.val * (now - start);
  const out = { train: [], val: [], test: [], start, trainEnd, valEnd };
  for (const p of positives || []) {
    if (!p?.userId || !p?.itemKey || !Number.isFinite(p.at) || p.at < start || p.at > now) continue;
    (p.at < trainEnd ? out.train : p.at < valEnd ? out.val : out.test).push(p);
  }
  return out;
}

// Id maps from the training positives (users and items with no training
// positive get no embedding; they fall back to the base score).
export function buildIndex(train, maxItems = CFG.maxLandmarks) {
  const itemCounts = new Map();
  for (const p of train) itemCounts.set(p.itemKey, (itemCounts.get(p.itemKey) || 0) + 1);
  const items = [...itemCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxItems).map(([k]) => k);
  const itemIdx = new Map(items.map((k, n) => [k, n]));
  const users = [...new Set(train.filter((p) => itemIdx.has(p.itemKey)).map((p) => p.userId))].sort();
  const userIdx = new Map(users.map((u, n) => [u, n]));
  return { users, items, userIdx, itemIdx };
}

// Unique (u, i) index pairs, and each user's positive item set.
function indexPairs(list, index) {
  const seen = new Set();
  const pairs = [];
  for (const p of list) {
    const u = index.userIdx.get(p.userId);
    const i = index.itemIdx.get(p.itemKey);
    if (u == null || i == null) continue;
    const k = `${u}|${i}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push([u, i]);
  }
  return pairs;
}

// For each positive, `k` items the user has no positive on (uniform). A
// user who has every item gets no negatives. poolOf(i), when given, returns
// the item indexes negatives for positive i are drawn from (v2: i's region);
// null means every item.
export function sampleNegatives(pairs, positivesOf, numItems, k, rng, poolOf = null) {
  const triples = [];
  for (const [u, i] of pairs) {
    const own = positivesOf.get(u) || new Set();
    const pool = poolOf ? poolOf(i) : null;
    const size = pool ? pool.length : numItems;
    if (own.size >= numItems || size < 1) continue;
    for (let n = 0; n < k; n++) {
      let j;
      let guard = 0;
      do {
        j = pool ? pool[Math.floor(rng() * size)] : Math.floor(rng() * numItems);
      } while (own.has(j) && ++guard < 1000);
      if (!own.has(j)) triples.push([u, i, j]);
    }
  }
  return triples;
}

// v2 negatives: the items of the positive's own region (item keys are
// "region/id"). A region with fewer than minSize items falls back to every
// item, so a tiny region still gets negatives.
export function regionPools(items, minSize = 5) {
  const byRegion = new Map();
  items.forEach((key, n) => {
    const region = String(key).split('/')[0];
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(n);
  });
  const regionOf = items.map((key) => String(key).split('/')[0]);
  return (i) => {
    const pool = byRegion.get(regionOf[i]);
    return pool && pool.length >= minSize ? pool : null;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Training -----------------------------------------------------------------

// One run of BPR training. trainPairs: [[u, i]]; valTriples fixed. Returns
// the best model by validation loss (or the last one with no validation).
export function trainModel({ model, trainPairs, positivesOf, valTriples = [], cfg = CFG, maxEpochs = cfg.epochs, budgetMs = Infinity, rng = seededRandom(cfg.seed + 1), onEpoch = null, poolOf = null }) {
  const opt = createAdam(model);
  const started = Date.now();
  const onLogit = cfg.bprOn === 'logit';
  const onAccuracy = cfg.earlyStoppingOn === 'accuracy' && valTriples.length > 0;
  let best = null;
  let bestLoss = Infinity;
  let bestMetric = -Infinity;
  let bestEpoch = 0;
  let sinceBest = 0;
  const history = [];
  let stoppedBy = 'epochs';
  for (let epoch = 1; epoch <= maxEpochs; epoch++) {
    const triples = shuffle(sampleNegatives(trainPairs, positivesOf, model.numItems, cfg.negativesPerPositive, rng, poolOf), rng);
    let trainLoss = 0;
    for (let s = 0; s < triples.length; s += cfg.batchSize) {
      const batch = triples.slice(s, s + cfg.batchSize);
      const g = zeroGrads(model);
      for (const [u, i, j] of batch) {
        const pos = forwardPair(model, u, i, { dropout: cfg.dropout, rng });
        const neg = forwardPair(model, u, j, { dropout: cfg.dropout, rng });
        const x = onLogit ? pos.z - neg.z : pos.y - neg.y;
        trainLoss += softplus(-x);
        const dx = sigmoid(x) - 1; // d(-log sigmoid(x))/dx
        backwardPair(model, u, i, pos, dx, g, onLogit);
        backwardPair(model, u, j, neg, -dx, g, onLogit);
      }
      applyGrads(model, opt, g, batch.length, { lr: cfg.learningRate, l2: cfg.l2, flushTiny: cfg.flushTiny === true });
    }
    trainLoss = triples.length ? trainLoss / triples.length : NaN;
    const valLoss = valTriples.length ? bprLoss(model, valTriples, onLogit) : trainLoss;
    const valAccuracy = onAccuracy ? pairwiseAccuracy(model, valTriples) : null;
    history.push({ epoch, trainLoss, valLoss, ...(onAccuracy ? { valAccuracy } : {}) });
    onEpoch?.({ epoch, trainLoss, valLoss, valAccuracy });
    // Higher is better for both: v1 keeps the lowest validation loss, v2 the
    // best validation ranking accuracy.
    const metric = onAccuracy ? valAccuracy : -valLoss;
    if (metric > bestMetric + 1e-6) {
      bestMetric = metric;
      bestLoss = valLoss;
      bestEpoch = epoch;
      best = cloneModel(model);
      sinceBest = 0;
    } else if (++sinceBest >= cfg.patience) {
      stoppedBy = 'early-stopping';
      break;
    }
    if (Date.now() - started > budgetMs) {
      stoppedBy = 'time-budget';
      break;
    }
  }
  return { model: best || model, bestEpoch, bestLoss, history, stoppedBy, ms: Date.now() - started };
}

// The whole weekly pipeline over raw positives:
//   1. temporal split, index from the training part
//   2. train with early stopping on validation; holdout accuracy on test
//   3. refit on the whole window for bestEpoch epochs (so this week's new
//      users and places get embeddings), and serve that
// Returns the serving model plus the evaluation.
export function trainNcf(positives, { now = Date.now(), cfg = CFG, budgetMs = 30_000, refit = true } = {}) {
  const split = temporalSplit(positives, { now, windowDays: cfg.windowDays, split: cfg.split });
  const index = buildIndex(split.train, cfg.maxLandmarks);
  const rng = seededRandom(cfg.seed + 2);
  const regional = cfg.negativeSampling === 'region';
  const poolOf = regional ? regionPools(index.items) : null;
  const evalTriples = (list, pool = poolOf, r = rng) => {
    const trainSet = new Set(indexPairs(split.train, index).map(([u, i]) => `${u}|${i}`));
    const pairs = indexPairs(list, index).filter(([u, i]) => !trainSet.has(`${u}|${i}`));
    return sampleNegatives(pairs, allPositivesOf, index.items.length, cfg.negativesPerPositive, r, pool);
  };
  const allPositivesOf = positivesByUser(indexPairs([...split.train, ...split.val, ...split.test], index));
  const trainPairs = indexPairs(split.train, index);
  const base = {
    trainedAt: now,
    counts: { positives: (positives || []).length, train: split.train.length, val: split.val.length, test: split.test.length, users: index.users.length, items: index.items.length },
  };
  if (!trainPairs.length || index.items.length < 2) return { ...base, ok: false, reason: 'not-enough-data' };
  const valTriples = evalTriples(split.val);
  const testTriples = evalTriples(split.test);
  const model = createModel({ numUsers: index.users.length, numItems: index.items.length, dim: cfg.embeddingDim, hidden: cfg.hidden, seed: cfg.seed });
  const run = trainModel({ model, trainPairs, positivesOf: positivesByUser(trainPairs), valTriples, cfg, budgetMs: refit ? budgetMs / 2 : budgetMs, poolOf });
  const testAccuracy = pairwiseAccuracy(run.model, testTriples);
  const valAccuracy = pairwiseAccuracy(run.model, valTriples);
  // The same holdout scored both ways, so v1 and v2 compare like for like on
  // the dashboard: against any place (v1's own test) and against places in
  // the positive's region (v2's own test; the harder, taste-only question).
  const otherRng = seededRandom(cfg.seed + 3);
  const testAccuracyCatalog = regional ? pairwiseAccuracy(run.model, evalTriples(split.test, null, otherRng)) : testAccuracy;
  const testAccuracyRegion = regional ? testAccuracy : pairwiseAccuracy(run.model, evalTriples(split.test, regionPools(index.items), otherRng));
  const evaluation = { family: cfg.family || 'v1', bestEpoch: run.bestEpoch, bestValLoss: run.bestLoss, stoppedBy: run.stoppedBy, earlyStoppingOn: cfg.earlyStoppingOn || 'loss', valAccuracy, testAccuracy, testAccuracyCatalog, testAccuracyRegion, testTriples: testTriples.length, valTriples: valTriples.length, history: run.history, trainMs: run.ms };
  if (!refit) return { ...base, ok: true, model: run.model, index, evaluation };

  const full = [...split.train, ...split.val, ...split.test];
  const fullIndex = buildIndex(full, cfg.maxLandmarks);
  const fullPairs = indexPairs(full, fullIndex);
  const fullModel = createModel({ numUsers: fullIndex.users.length, numItems: fullIndex.items.length, dim: cfg.embeddingDim, hidden: cfg.hidden, seed: cfg.seed });
  const refitRun = trainModel({ model: fullModel, trainPairs: fullPairs, positivesOf: positivesByUser(fullPairs), cfg, maxEpochs: Math.max(1, run.bestEpoch), budgetMs: budgetMs / 2, poolOf: regional ? regionPools(fullIndex.items) : null });
  evaluation.refitEpochs = refitRun.history.length;
  evaluation.refitMs = refitRun.ms;
  return { ...base, ok: true, model: refitRun.model, index: fullIndex, evaluation };
}

function positivesByUser(pairs) {
  const out = new Map();
  for (const [u, i] of pairs) {
    if (!out.has(u)) out.set(u, new Set());
    out.get(u).add(i);
  }
  return out;
}

// ---- Storage --------------------------------------------------------------------

const round = (x, dp) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
const plain = (arr, dp) => Array.from(arr, (x) => round(x, dp));

// The shared part (MLP + landmark embeddings), as plain JSON for Firestore,
// and each user's own embedding, kept apart (owner-only docs).
export function serializeModel({ model, index }, { dp = CFG.storeDecimals, meta = {} } = {}) {
  const d = model.dim;
  const items = {};
  index.items.forEach((k, n) => {
    items[k] = plain(model.I.subarray(n * d, n * d + d), dp);
  });
  const users = {};
  index.users.forEach((u, n) => {
    users[u] = plain(model.U.subarray(n * d, n * d + d), dp);
  });
  return {
    shared: {
      dim: d,
      hidden: model.hidden,
      layers: model.layers.map((l) => ({ in: l.in, out: l.out, W: plain(l.W, dp), b: plain(l.b, dp) })),
      items,
      ...meta,
    },
    users,
  };
}

// ---- Serving --------------------------------------------------------------------

// A stored model doc (mapr_models/ncf or ncf_v2) as the ranking reads it.
// family says which blend goes with it (rank.js): v1 unless the doc says v2.
export function ncfFromDoc(d) {
  return d?.layers && d?.items ? { dim: d.dim, layers: d.layers, items: d.items, version: d.version ?? null, family: d.family === 'v2' ? 'v2' : 'v1', active: d.active === true, activeUsers: d.activeUsers ?? null } : null;
}

// A ready-to-score model on the phone: the user's half of the first layer is
// computed once, so each landmark costs one 32-wide half plus the rest of
// the MLP. Null when anything is missing or malformed.
export function prepareScorer(shared, userEmbedding) {
  try {
    const d = shared?.dim;
    const layers = shared?.layers;
    if (!Number.isInteger(d) || !Array.isArray(layers) || layers.length < 2) return null;
    if (!Array.isArray(userEmbedding) || userEmbedding.length !== d || !userEmbedding.every(Number.isFinite)) return null;
    const L = layers.map((l) => ({ in: l.in, out: l.out, W: Float64Array.from(l.W), b: Float64Array.from(l.b) }));
    if (L[0].in !== 2 * d || L.some((l) => l.W.length !== l.in * l.out || l.b.length !== l.out)) return null;
    const first = L[0];
    const userPart = new Float64Array(first.out);
    for (let o = 0; o < first.out; o++) {
      let s = first.b[o];
      for (let j = 0; j < d; j++) s += first.W[o * first.in + j] * userEmbedding[j];
      userPart[o] = s;
    }
    const items = shared.items || {};
    const score = (itemKey) => {
      const e = items[itemKey];
      if (!Array.isArray(e) || e.length !== d) return null;
      let h = new Float64Array(first.out);
      for (let o = 0; o < first.out; o++) {
        let s = userPart[o];
        const row = o * first.in + d;
        for (let j = 0; j < d; j++) s += first.W[row + j] * e[j];
        h[o] = s > 0 ? s : 0;
      }
      for (let k = 1; k < L.length; k++) {
        const { W, b, out, in: n } = L[k];
        const z = new Float64Array(out);
        for (let o = 0; o < out; o++) {
          let s = b[o];
          for (let j = 0; j < n; j++) s += W[o * n + j] * h[j];
          z[o] = k === L.length - 1 ? s : s > 0 ? s : 0;
        }
        h = z;
      }
      const y = sigmoid(h[0]);
      return Number.isFinite(y) ? y : null;
    };
    return { score, hasItem: (k) => Array.isArray(items[k]) };
  } catch {
    return null;
  }
}

// Weekly promotion rule: keep the previous checkpoint when the new one's
// holdout accuracy is more than maxTestDrop (relative) below it.
export function shouldPromote(newAcc, prevAcc, maxDrop = CFG.maxTestDrop) {
  if (!Number.isFinite(newAcc)) return !Number.isFinite(prevAcc);
  if (!Number.isFinite(prevAcc) || prevAcc <= 0) return true;
  return newAcc >= prevAcc * (1 - maxDrop);
}

// Drift: the live model's accuracy on this week's fresh data, against what it
// was promoted with. True means roll back to the previous checkpoint.
export function hasDrifted(liveAcc, promotedAcc, maxDrop = CFG.maxDriftDrop) {
  if (!Number.isFinite(liveAcc) || !Number.isFinite(promotedAcc) || promotedAcc <= 0) return false;
  return liveAcc < promotedAcc * (1 - maxDrop);
}

// Exposed for the gradient check in tests.
export const _internals = { forwardPair, backwardPair, zeroGrads, applyGrads, createAdam, softplus, sigmoid, cloneModel, indexPairs };
