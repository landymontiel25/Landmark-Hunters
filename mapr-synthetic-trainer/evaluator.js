// Ranking metrics for one user, plus the mean/sd helpers the Monte Carlo
// summary uses. Scores and relevance are parallel arrays over the user's
// candidate places. Ties are broken by candidate order, which the caller
// shuffles once per user so no ranker gets a free ordering.

export const K = 10;

// Indexes of the top k scores, best first.
export function topK(scores, k = K) {
  const idx = Array.from(scores.keys());
  idx.sort((a, b) => scores[b] - scores[a] || a - b);
  return idx.slice(0, k);
}

// Binary relevance (rel[i] > 0 counts as relevant).
//   ndcg     DCG@k / ideal DCG@k
//   ap       average precision at k, over min(#relevant, k)
//   recall   relevant in top k / all relevant
//   hit      1 if any relevant in top k
export function rankingMetrics(scores, rel, k = K) {
  const totalRel = rel.reduce((s, r) => s + (r > 0 ? 1 : 0), 0);
  if (!totalRel) return null;
  const top = topK(scores, k);
  let dcg = 0;
  let hits = 0;
  let ap = 0;
  top.forEach((i, pos) => {
    if (rel[i] > 0) {
      hits++;
      dcg += 1 / Math.log2(pos + 2);
      ap += hits / (pos + 1);
    }
  });
  let idcg = 0;
  for (let p = 0; p < Math.min(totalRel, k); p++) idcg += 1 / Math.log2(p + 2);
  return { ndcg: dcg / idcg, ap: ap / Math.min(totalRel, k), recall: hits / totalRel, hit: hits > 0 ? 1 : 0 };
}

// Held-out pairwise accuracy: of every (liked, not liked) pair among the
// places the user actually rated or skipped in the test split, the share
// the scores put in the right order. Ties count half. This is an AUC.
export function pairwiseAccuracy(scores, positive) {
  let pairs = 0;
  let right = 0;
  for (let a = 0; a < scores.length; a++) {
    if (!positive[a]) continue;
    for (let b = 0; b < scores.length; b++) {
      if (positive[b]) continue;
      pairs++;
      if (scores[a] > scores[b]) right += 1;
      else if (scores[a] === scores[b]) right += 0.5;
    }
  }
  return pairs ? { right, pairs } : null;
}

// NDCG@k with graded gains (2^rel - 1) over the places the user actually
// met in the test split: did the order put what they loved most on top?
export function gradedNdcg(scores, rel, k = K) {
  const top = topK(scores, k);
  let dcg = 0;
  top.forEach((i, pos) => (dcg += (2 ** rel[i] - 1) / Math.log2(pos + 2)));
  const ideal = [...rel].sort((a, b) => b - a).slice(0, k);
  let idcg = 0;
  ideal.forEach((r, pos) => (idcg += (2 ** r - 1) / Math.log2(pos + 2)));
  return idcg > 0 ? dcg / idcg : null;
}

export function meanSd(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: null, sd: null, n: 0, min: null, max: null };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd, n: v.length, min: Math.min(...v), max: Math.max(...v) };
}

// Accumulates per-user metrics for one ranker.
export class MetricSum {
  constructor() {
    this.n = 0;
    this.ndcg = 0;
    this.ap = 0;
    this.recall = 0;
    this.hit = 0;
    this.pairs = 0;
    this.right = 0;
    this.usersWithPairs = 0;
    this.heldNdcg = 0;
    this.heldN = 0;
  }

  addHeldOut(v) {
    if (v == null) return;
    this.heldNdcg += v;
    this.heldN++;
  }

  addRanking(m) {
    if (!m) return;
    this.n++;
    this.ndcg += m.ndcg;
    this.ap += m.ap;
    this.recall += m.recall;
    this.hit += m.hit;
  }

  addPairs(p) {
    if (!p) return;
    this.pairs += p.pairs;
    this.right += p.right;
    this.usersWithPairs++;
  }

  result() {
    const avg = (x) => (this.n ? x / this.n : null);
    return {
      accuracy: this.pairs ? this.right / this.pairs : null,
      ndcg_10: avg(this.ndcg),
      map_10: avg(this.ap),
      recall_10: avg(this.recall),
      hit_rate_10: avg(this.hit),
      heldout_ndcg_10: this.heldN ? this.heldNdcg / this.heldN : null,
      users_ranked: this.n,
      users_with_pairs: this.usersWithPairs,
      pairs: this.pairs,
    };
  }
}
