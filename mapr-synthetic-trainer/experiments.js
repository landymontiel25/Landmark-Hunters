import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMonteCarlo } from './monte-carlo.js';
import { OUT_DIR } from './pipeline.js';

// Diagnostics after the main run: why does NCF learn so little? Re-trains
// simulation 1 of batches A and C with one production choice changed at a
// time. Production code and config are untouched; these are offline what-ifs.
//   node experiments.js            writes output/experiments.json

export const VARIANTS = {
  logit: { bpr_on: 'logit' },
  area: { negative_sampling: 'area' },
  logit_area: { bpr_on: 'logit', negative_sampling: 'area' },
};
const BATCHES = [{ name: 'A', users: 1000 }, { name: 'C', users: 10000 }];

const out = {};
await Promise.all(
  Object.entries(VARIANTS).map(async ([name, ncfConfig]) => {
    const res = await runMonteCarlo({ sims: 1, batches: BATCHES, workers: 1, ncfConfig, outDir: OUT_DIR, exportFrom: { batch: null }, emit: (e) => e.type === 'job-done' && console.log(`${name} ${e.job.id}: NCF ${(e.result.rankers.ncf.accuracy * 100).toFixed(1)}%, blend ${(e.result.rankers.mapr.accuracy * 100).toFixed(1)}%, cold blend ${(e.result.cold.mapr.accuracy * 100).toFixed(1)}%`) });
    out[name] = { ncfConfig, results: Object.fromEntries(Object.entries(res).map(([b, runs]) => [b, runs.map(({ archetypes: _a, ...r }) => r)])) };
  })
);
writeFileSync(path.join(OUT_DIR, 'experiments.json'), JSON.stringify(out, null, 1));
console.log('wrote output/experiments.json');
