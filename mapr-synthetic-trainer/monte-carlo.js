import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededRandom } from '../src/lib/maprRank/experiments.js';
import { DEFAULT_VARIATION } from './synthetic-users.js';

// Hybrid Monte Carlo: every batch (A 1k, B 5k, C 10k users) is trained 10
// times, each on a freshly simulated population. Per simulation:
//   seed            new users, new places met, new noise draws
//   mixVariation    archetype shares scaled by 1 + U(-5%, +5%)
//   prefVariance    per-user preference spread, 0.25 x (1 + U(-5%, +5%))
//   noiseScale      rating noise x (1 + U(-10%, +10%))
// Within one simulation, B contains A and C contains B (prefixes of the
// same population), so the learning curve compares like with like.
// Runs are spread over worker threads, A runs first, then B, then C.

export const BATCHES = [
  { name: 'A', users: 1000 },
  { name: 'B', users: 5000 },
  { name: 'C', users: 10000 },
];
export const SIMS = 10;
export const COLD_USERS = 500;
const MASTER_SEED = 2026;

export function simulationPlans(sims = SIMS) {
  const rng = seededRandom(MASTER_SEED);
  return Array.from({ length: sims }, (_, k) => {
    const pref = DEFAULT_VARIATION.prefVariance * (1 + (rng() * 2 - 1) * 0.05);
    const noise = DEFAULT_VARIATION.noiseScale * (1 + (rng() * 2 - 1) * 0.1);
    return {
      sim: k + 1,
      seed: 1000 + k + 1,
      variation: { mixVariation: DEFAULT_VARIATION.mixVariation, prefVariance: Math.round(pref * 10000) / 10000, noiseScale: Math.round(noise * 10000) / 10000 },
    };
  });
}

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'mc-worker.js');

// emit(event) receives: job-start, epoch, log, job-done, job-error.
// Resolves to { [batchName]: [result per sim] }.
export function runMonteCarlo({ sims = SIMS, batches = BATCHES, workers = Math.max(1, Math.min(4, cpus().length)), ncfConfig = {}, evalUsers, outDir, exportFrom = { batch: 'C', sim: 1 }, emit = () => {} }) {
  const plans = simulationPlans(sims);
  const jobs = [];
  for (const b of batches) for (const p of plans) jobs.push({ id: `${b.name}${p.sim}`, batch: b.name, users: b.users, ...p, coldUsers: COLD_USERS, ncfConfig, evalUsers, exportDir: b.name === exportFrom.batch && p.sim === exportFrom.sim ? outDir : null });
  const results = Object.fromEntries(batches.map((b) => [b.name, []]));
  let next = 0;
  let running = 0;
  return new Promise((resolve, reject) => {
    const pool = [];
    const launch = (w) => {
      if (next >= jobs.length) {
        w.terminate();
        if (--running === 0) resolve(results);
        return;
      }
      const job = jobs[next++];
      w.busy = job;
      emit({ type: 'job-start', job: strip(job), queued: jobs.length - next });
      w.postMessage(job);
    };
    for (let k = 0; k < Math.min(workers, jobs.length); k++) {
      const w = new Worker(WORKER);
      running++;
      w.on('message', (msg) => {
        if (msg.type === 'epoch' || msg.type === 'log') emit({ ...msg, job: strip(w.busy) });
        else if (msg.type === 'done') {
          results[w.busy.batch].push(msg.result);
          results[w.busy.batch].sort((a, b) => a.sim - b.sim);
          emit({ type: 'job-done', job: strip(w.busy), result: msg.result });
          launch(w);
        } else if (msg.type === 'error') {
          emit({ type: 'job-error', job: strip(w.busy), error: msg.error });
          reject(new Error(`${w.busy.id}: ${msg.error}`));
        }
      });
      w.on('error', reject);
      pool.push(w);
      launch(w);
    }
  });
}

const strip = (j) => (j ? { id: j.id, batch: j.batch, users: j.users, sim: j.sim, seed: j.seed, variation: j.variation } : null);
