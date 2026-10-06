import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { meanSd } from './evaluator.js';

// Paired comparison of two full runs on the same simulated populations
// (same seeds, so simulation k of batch B in both runs has the same
// travelers and the same ratings).
//   node compare-runs.js [baselineDir] [candidateDir]
// Defaults: output (production NCF) vs output-fix (the three NCF fixes).
// Writes <candidateDir>/comparison.csv and <candidateDir>/comparison.json.

const here = path.dirname(fileURLToPath(import.meta.url));
const [baseDir = path.join(here, 'output'), candDir = path.join(here, 'output-fix')] = process.argv.slice(2);
const load = (dir, b) => JSON.parse(readFileSync(path.join(dir, `batch-${b}-results.json`), 'utf8')).simulations;

const rows = [];
const batches = {};
for (const b of ['A', 'B', 'C']) {
  const base = new Map(load(baseDir, b).map((r) => [r.sim, r]));
  const cand = load(candDir, b);
  const per = cand.map((r) => {
    const o = base.get(r.sim);
    const row = {
      batch: b,
      users: r.users,
      sim: r.sim,
      seed: r.seed,
      fixed_blend: r.rankers.mapr.accuracy,
      tag_sim: r.rankers.tag_sim.accuracy,
      old_blend: o?.rankers.mapr.accuracy ?? null,
      fixed_ncf: r.rankers.ncf.accuracy,
      old_ncf: o?.rankers.ncf.accuracy ?? null,
      fixed_heldout_ndcg: r.rankers.mapr.heldout_ndcg_10,
      tag_sim_heldout_ndcg: r.rankers.tag_sim.heldout_ndcg_10,
      fixed_cold_blend: r.cold.mapr.accuracy,
      cold_today: r.cold.tag_sim.accuracy,
      old_cold_blend: o?.cold.mapr.accuracy ?? null,
      fixed_best_epoch: r.ncf.best_epoch,
      fixed_epochs_run: r.ncf.epochs_run,
      fixed_stopped_by: r.ncf.stopped_by,
      fixed_train_min: r.ncf.ms / 60000,
      old_train_min: o ? o.ncf.ms / 60000 : null,
    };
    row.blend_minus_tag_sim = row.fixed_blend - row.tag_sim;
    row.blend_minus_old_blend = row.old_blend == null ? null : row.fixed_blend - row.old_blend;
    row.beats_tag_sim = row.fixed_blend > row.tag_sim;
    row.beats_old_blend = row.old_blend != null && row.fixed_blend > row.old_blend;
    row.cold_beats_today = row.fixed_cold_blend > row.cold_today;
    return row;
  });
  rows.push(...per);
  const ms = (k) => meanSd(per.map((r) => r[k]));
  batches[b] = {
    users: per[0]?.users,
    sims: per.length,
    fixed_blend: ms('fixed_blend'),
    tag_sim: ms('tag_sim'),
    old_blend: ms('old_blend'),
    fixed_ncf: ms('fixed_ncf'),
    old_ncf: ms('old_ncf'),
    blend_minus_tag_sim: ms('blend_minus_tag_sim'),
    blend_minus_old_blend: ms('blend_minus_old_blend'),
    wins_vs_tag_sim: per.filter((r) => r.beats_tag_sim).length,
    wins_vs_old_blend: per.filter((r) => r.beats_old_blend).length,
    fixed_heldout_ndcg: ms('fixed_heldout_ndcg'),
    tag_sim_heldout_ndcg: ms('tag_sim_heldout_ndcg'),
    fixed_cold_blend: ms('fixed_cold_blend'),
    cold_today: ms('cold_today'),
    old_cold_blend: ms('old_cold_blend'),
    cold_wins_vs_today: per.filter((r) => r.cold_beats_today).length,
    fixed_epochs_run: ms('fixed_epochs_run'),
    fixed_best_epoch: ms('fixed_best_epoch'),
    fixed_train_min: ms('fixed_train_min'),
    old_train_min: ms('old_train_min'),
    stopped_by: per.reduce((m, r) => ({ ...m, [r.fixed_stopped_by]: (m[r.fixed_stopped_by] || 0) + 1 }), {}),
  };
}
const round = (x) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
writeFileSync(path.join(candDir, 'comparison.csv'), Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)])))));
writeFileSync(path.join(candDir, 'comparison.json'), JSON.stringify({ baseline: baseDir, candidate: candDir, batches, simulations: rows }, null, 1));
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);
for (const [b, s] of Object.entries(batches)) {
  console.log(`Batch ${b} (${s.users} users, ${s.sims} sims): fixed blend ${pct(s.fixed_blend.mean)} +- ${pct(s.fixed_blend.sd)} | tag+sim ${pct(s.tag_sim.mean)} | old blend ${pct(s.old_blend.mean)} | beats tag+sim ${s.wins_vs_tag_sim}/${s.sims} | beats old blend ${s.wins_vs_old_blend}/${s.sims}`);
}
