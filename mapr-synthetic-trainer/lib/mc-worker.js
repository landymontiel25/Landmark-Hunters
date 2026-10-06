import { parentPort } from 'node:worker_threads';
import { loadCatalog } from './catalog.js';
import { buildDataset } from './dataset.js';
import { runBatch } from '../batch-trainer.js';

// One Monte Carlo job per message: simulate the population, train, evaluate.

parentPort.on('message', async (job) => {
  try {
    const catalog = await loadCatalog();
    const ds = buildDataset(catalog, { seed: job.seed, variation: job.variation, users: job.users, coldUsers: job.coldUsers, ...(job.coldOffset != null ? { coldOffset: job.coldOffset } : {}) });
    const result = await runBatch({
      catalog,
      ds,
      nUsers: job.users,
      batch: job.batch,
      sim: job.sim,
      ncfConfig: job.ncfConfig,
      blendWeights: job.blendWeights || [],
      labBlend: job.labBlend,
      extended: job.extended,
      evalUsers: job.evalUsers,
      exportDir: job.exportDir,
      onEpoch: (row) => parentPort.postMessage({ type: 'epoch', row }),
      onLab: job.lab ? (lab) => lab && parentPort.postMessage({ type: 'lab', lab }) : null,
      log: (text) => parentPort.postMessage({ type: 'log', text }),
    });
    parentPort.postMessage({ type: 'done', result });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: e?.stack || String(e) });
  }
});
