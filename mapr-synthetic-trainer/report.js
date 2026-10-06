import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { meanSd } from './evaluator.js';
import { RANKERS } from './batch-trainer.js';

// Turns the Monte Carlo results into the output files:
//   batch-{A,B,C}-results.json   every simulation's full result + the batch summary
//   learning-curve.csv           one row per batch, mean and sd over simulations
//   final-report.csv             every metric: per batch and ranker, cold start,
//                                archetypes, model health, feature lift
//   summary.json                 what the dashboard's final pages read

const METRICS = ['accuracy', 'ndcg_10', 'map_10', 'recall_10', 'hit_rate_10', 'heldout_ndcg_10'];

function summarize(runs, pick) {
  const out = {};
  const names = new Set(runs.flatMap((r) => Object.keys(pick(r) || {})));
  for (const name of names) out[name] = Object.fromEntries(METRICS.map((m) => [m, meanSd(runs.map((r) => pick(r)?.[name]?.[m]))]));
  return out;
}

export function summarizeBatch(name, runs) {
  return {
    batch: name,
    users: runs[0]?.users,
    interactions: runs[0]?.interactions,
    sims: runs.length,
    training_positives: meanSd(runs.map((r) => r.training_positives)),
    eval_users: runs[0]?.eval_users,
    rankers: summarize(runs, (r) => r.rankers),
    cold: summarize(runs, (r) => r.cold),
    ncf: {
      epochs_run: meanSd(runs.map((r) => r.ncf.epochs_run)),
      best_epoch: meanSd(runs.map((r) => r.ncf.best_epoch)),
      stopped_by: runs.reduce((m, r) => ({ ...m, [r.ncf.stopped_by]: (m[r.ncf.stopped_by] || 0) + 1 }), {}),
      first_train_loss: meanSd(runs.map((r) => r.ncf.history[0]?.train_loss)),
      best_train_loss: meanSd(runs.map((r) => r.ncf.history[r.ncf.best_epoch - 1]?.train_loss)),
      last_train_loss: meanSd(runs.map((r) => r.ncf.history.at(-1)?.train_loss)),
      first_val_accuracy: meanSd(runs.map((r) => r.ncf.history[0]?.val_accuracy)),
      best_val_accuracy: meanSd(runs.map((r) => r.ncf.final_val_accuracy)),
      train_ms: meanSd(runs.map((r) => r.ncf.ms)),
    },
    similarity: { bytes: meanSd(runs.map((r) => r.similarity.bytes)), ms: meanSd(runs.map((r) => r.similarity.ms)), rows: meanSd(runs.map((r) => r.similarity.rows)) },
    total_ms: meanSd(runs.map((r) => r.timing.total_ms)),
    per_sim: runs.map((r) => ({ sim: r.sim, seed: r.seed, variation: r.variation, ncf_accuracy: r.rankers.ncf?.accuracy, mapr_accuracy: r.rankers.mapr?.accuracy, tag_sim_accuracy: r.rankers.tag_sim?.accuracy, epochs: r.ncf.epochs_run, stopped_by: r.ncf.stopped_by })),
  };
}

// Pooled over simulations: each archetype's (liked, not liked) pairs from
// every simulation's evaluation users.
export function archetypeTable(runs) {
  const acc = new Map();
  for (const r of runs) {
    for (const [name, a] of Object.entries(r.archetypes)) {
      if (!acc.has(name)) acc.set(name, { users: 0, perSim: [], pooled: {} });
      const e = acc.get(name);
      e.users += a.users;
      e.perSim.push(a.ncf?.accuracy);
      for (const k of ['ncf', 'mapr', 'tag_sim', 'oracle']) {
        if (!a[k]) continue;
        e.pooled[k] ||= { right: 0, pairs: 0, ndcg: 0, n: 0 };
        e.pooled[k].right += (a[k].accuracy || 0) * a[k].pairs;
        e.pooled[k].pairs += a[k].pairs;
        if (a[k].heldout_ndcg_10 != null) {
          e.pooled[k].ndcg += a[k].heldout_ndcg_10 * a[k].users_ranked;
          e.pooled[k].n += a[k].users_ranked;
        }
      }
    }
  }
  const rate = (p) => (p?.pairs ? p.right / p.pairs : null);
  return [...acc]
    .map(([archetype, e]) => ({
      archetype,
      users: e.users,
      pairs: e.pooled.ncf?.pairs || 0,
      ncf_accuracy: rate(e.pooled.ncf),
      mapr_accuracy: rate(e.pooled.mapr),
      tag_sim_accuracy: rate(e.pooled.tag_sim),
      oracle_accuracy: rate(e.pooled.oracle),
      ncf_accuracy_sd_over_sims: meanSd(e.perSim).sd,
    }))
    .sort((a, b) => (b.ncf_accuracy ?? -1) - (a.ncf_accuracy ?? -1));
}

const pct = (x) => (x == null ? '' : Math.round(x * 10000) / 100);
const num = (x, dp = 4) => (x == null || !Number.isFinite(x) ? '' : Math.round(x * 10 ** dp) / 10 ** dp);

export function writeReports(outDir, results, { config = {}, generation = null } = {}) {
  const batches = Object.entries(results).map(([name, runs]) => summarizeBatch(name, runs));
  for (const [name, runs] of Object.entries(results)) {
    const summary = batches.find((b) => b.batch === name);
    writeFileSync(path.join(outDir, `batch-${name}-results.json`), JSON.stringify({ summary, simulations: runs }, null, 1));
  }
  const last = Object.keys(results).at(-1);
  const archetypes = archetypeTable(results[last] || []);
  const exportRun = (results[last] || []).find((r) => r.feature_lift_top);

  // learning-curve.csv
  const curve = batches.map((b) => {
    const r = b.rankers;
    const row = { batch: b.batch, users: b.users, interactions: b.interactions, simulations: b.sims };
    for (const k of ['ncf', 'mapr', 'tag_sim', 'tag', 'popularity', 'random', 'oracle']) {
      row[`${k}_accuracy_pct`] = pct(r[k]?.accuracy.mean);
      row[`${k}_accuracy_sd_pct`] = pct(r[k]?.accuracy.sd);
    }
    row.ncf_heldout_ndcg_10 = num(r.ncf?.heldout_ndcg_10.mean);
    row.ncf_ndcg_10 = num(r.ncf?.ndcg_10.mean);
    row.ncf_map_10 = num(r.ncf?.map_10.mean);
    row.ncf_recall_10 = num(r.ncf?.recall_10.mean);
    row.mapr_heldout_ndcg_10 = num(r.mapr?.heldout_ndcg_10.mean);
    row.cold_mapr_today_accuracy_pct = pct(b.cold.tag_sim?.accuracy.mean);
    row.cold_mapr_with_pretrained_ncf_accuracy_pct = pct(b.cold.mapr?.accuracy.mean);
    row.cold_ncf_foldin_accuracy_pct = pct(b.cold.ncf?.accuracy.mean);
    row.ncf_epochs_mean = num(b.ncf.epochs_run.mean, 1);
    row.ncf_train_minutes_mean = num(b.ncf.train_ms.mean / 60000, 2);
    return row;
  });
  writeFileSync(path.join(outDir, 'learning-curve.csv'), Papa.unparse(curve));

  // final-report.csv
  const rows = [];
  const add = (section, item, metric, value, sd = '', n = '') => rows.push({ section, item, metric, value, sd, n });
  for (const b of batches) {
    for (const [ranker, m] of Object.entries(b.rankers)) for (const [metric, s] of Object.entries(m)) add(`batch ${b.batch} (${b.users} users)`, ranker, metric, num(s.mean), num(s.sd), s.n);
    for (const [ranker, m] of Object.entries(b.cold)) for (const [metric, s] of Object.entries(m)) add(`batch ${b.batch} cold start (never-trained users, ${5} ratings known)`, ranker, metric, num(s.mean), num(s.sd), s.n);
    add(`batch ${b.batch} model health`, 'ncf', 'epochs_run', num(b.ncf.epochs_run.mean, 1), num(b.ncf.epochs_run.sd, 1), b.sims);
    add(`batch ${b.batch} model health`, 'ncf', 'stopped_by', JSON.stringify(b.ncf.stopped_by));
    add(`batch ${b.batch} model health`, 'ncf', 'train_loss_epoch_1', num(b.ncf.first_train_loss.mean), num(b.ncf.first_train_loss.sd), b.sims);
    add(`batch ${b.batch} model health`, 'ncf', 'train_loss_best_epoch', num(b.ncf.best_train_loss.mean), num(b.ncf.best_train_loss.sd), b.sims);
    add(`batch ${b.batch} model health`, 'ncf', 'train_minutes', num(b.ncf.train_ms.mean / 60000, 2), num(b.ncf.train_ms.sd / 60000, 2), b.sims);
    add(`batch ${b.batch} model health`, 'similarity', 'matrix_bytes', num(b.similarity.bytes.mean, 0), num(b.similarity.bytes.sd, 0), b.sims);
  }
  for (const a of archetypes) {
    add(`archetypes (batch ${last}, pooled over simulations)`, a.archetype, 'ncf_accuracy', num(a.ncf_accuracy), num(a.ncf_accuracy_sd_over_sims), a.users);
    add(`archetypes (batch ${last}, pooled over simulations)`, a.archetype, 'mapr_accuracy', num(a.mapr_accuracy), '', a.users);
    add(`archetypes (batch ${last}, pooled over simulations)`, a.archetype, 'tag_sim_accuracy', num(a.tag_sim_accuracy), '', a.users);
  }
  for (const f of exportRun?.feature_lift_top || []) add('most predictive taste features (lift)', f.feature, 'lift', num(f.lift, 3), '', f.interactions);
  writeFileSync(path.join(outDir, 'final-report.csv'), Papa.unparse(rows));

  const summary = { generated_at: new Date().toISOString(), config, generation, rankers: RANKERS, batches, archetypes, feature_lift_top: exportRun?.feature_lift_top || [], feature_lift_bottom: exportRun?.feature_lift_bottom || [], verdict: verdict(batches) };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  return summary;
}

// Plain checks of the spec's green and red flags, computed, not asserted.
export function verdict(batches) {
  const acc = batches.map((b) => b.rankers.ncf?.accuracy);
  const sd = acc.map((a) => a?.sd);
  const lossDown = batches.every((b) => b.ncf.last_train_loss.mean < b.ncf.first_train_loss.mean);
  const improves = acc.every((a, k) => k === 0 || (a?.mean ?? 0) > (acc[k - 1]?.mean ?? 0));
  const narrows = sd.every((s, k) => k === 0 || (s ?? 1) <= (sd[k - 1] ?? 0) + 1e-9);
  const last = batches.at(-1);
  const blendBeatsBase = (last?.rankers.mapr?.accuracy.mean ?? 0) > (last?.rankers.tag_sim?.accuracy.mean ?? 0);
  return {
    training_loss_decreases: lossDown,
    ncf_accuracy_improves_with_users: improves,
    ncf_confidence_interval_narrows: narrows,
    full_blend_beats_tag_and_similarity: blendBeatsBase,
    ncf_accuracy_by_batch: acc.map((a, k) => ({ batch: batches[k].batch, mean: a?.mean, sd: a?.sd })),
  };
}
