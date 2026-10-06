import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { loadCatalog } from './lib/catalog.js';
import { buildDataset, PER_USER } from './lib/dataset.js';
import { emulatorDb, emulatorReachable, writeCollection } from './lib/emulator.js';
import { ARCHETYPES } from './synthetic-users.js';
import { BATCHES, COLD_USERS, SIMS, runMonteCarlo, simulationPlans } from './monte-carlo.js';
import { writeReports } from './report.js';

// The whole run: generate -> (emulator) -> Monte Carlo training -> reports.
// emit(event) feeds the dashboard (server.js) or the console.

// MAPR_OUT_DIR moves every output file (used to try a run without
// overwriting the last full one).
export const OUT_DIR = process.env.MAPR_OUT_DIR ? path.resolve(process.env.MAPR_OUT_DIR) : path.join(path.dirname(fileURLToPath(import.meta.url)), 'output');
// Every event of the current run, one JSON line each, so a dashboard started
// later (or restarted) can replay the run and keep following it.
export const EVENTS_FILE = path.join(OUT_DIR, 'events.jsonl');

export function eventLogger(emit = () => {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(EVENTS_FILE, '');
  return (e) => {
    const event = { at: Date.now(), ...e };
    appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`);
    emit(event);
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const opt = { quick: false, sims: SIMS, workers: undefined, epochs: undefined };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--quick') opt.quick = true;
    else if (a === '--sims') opt.sims = Number(argv[++k]);
    else if (a === '--workers') opt.workers = Number(argv[++k]);
    else if (a === '--epochs') opt.epochs = Number(argv[++k]);
    else if (a === '--view') opt.view = true;
    else if (a === '--port') opt.port = Number(argv[++k]);
    // The three fixes from the first diagnostic run, all at once.
    // Extended validation: custom batches ("D:50000,E:100000"), cold-start
    // users moved past the largest batch, no 1 GB data files, the winning
    // signed 0.2 blend in the lab and the extended metrics.
    else if (a === '--batches') opt.batches = argv[++k].split(',').map((x) => ({ name: x.split(':')[0], users: Number(x.split(':')[1]) }));
    else if (a === '--cold-offset') opt.coldOffset = Number(argv[++k]);
    else if (a === '--no-data-files') opt.noDataFiles = true;
    else if (a === '--extended') {
      opt.extended = { key: 'mapr_signed_w0.2', reveals: [5, 10, 20, 35] };
      opt.labBlend = { weight: 0.2, signed: true };
    } else if (a === '--blend-weights') opt.blendWeights = argv[++k].split(',').map(Number);
    else if (a === '--fixed') opt.ncf = { ...opt.ncf, bpr_on: 'logit', negative_sampling: 'area', early_stopping_on: 'accuracy' };
    else if (a === '--bpr-on') opt.ncf = { ...opt.ncf, bpr_on: argv[++k] };
    else if (a === '--negatives') opt.ncf = { ...opt.ncf, negative_sampling: argv[++k] };
    else if (a === '--stop-on') opt.ncf = { ...opt.ncf, early_stopping_on: argv[++k] };
  }
  return opt;
}

async function writeJsonArray(file, items, toJson, onProgress) {
  const out = createWriteStream(file);
  out.write('[\n');
  let k = 0;
  for (const item of items) {
    if (!out.write(`${k ? ',\n' : ''}${JSON.stringify(toJson(item))}`)) await once(out, 'drain');
    k++;
    if (onProgress && k % 50_000 === 0) onProgress(k);
  }
  out.end('\n]\n');
  await once(out, 'finish');
}

export async function runPipeline({ quick = false, sims = SIMS, workers, epochs, ncf = {}, blendWeights = [], batches: customBatches = null, coldOffset, noDataFiles = false, extended = null, labBlend, emit = () => {} } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  const t0 = Date.now();
  const batches = customBatches || (quick ? [{ name: 'A', users: 300 }, { name: 'B', users: 600 }, { name: 'C', users: 1000 }] : BATCHES);
  const nSims = quick ? Math.min(sims, 2) : sims;
  const ncfConfig = { ...ncf, ...(epochs || quick ? { epochs: epochs || 4 } : {}) };
  const config = { batches, sims: nSims, cold_users: COLD_USERS, interactions_per_user: PER_USER, archetypes: ARCHETYPES.length, ncf: ncfConfig, quick, blend_weights: blendWeights, cold_offset: coldOffset ?? null, extended, lab_blend: labBlend ?? null };
  emit({ type: 'phase', phase: 'generation', config });

  // ---- 1. Generation (simulation 1's population, saved as the canonical set)
  const catalog = await loadCatalog();
  const plan = simulationPlans(1)[0];
  const total = batches.at(-1).users;
  const g0 = Date.now();
  const ds = buildDataset(catalog, {
    seed: plan.seed,
    variation: plan.variation,
    users: total,
    progressEvery: 100,
    onProgress: ({ users, interactions, last }) => emit({ type: 'generation', users, total, interactions, totalInteractions: total * PER_USER, archetype: last.archetype, user_id: last.user_id, city: last.city, elapsed_ms: Date.now() - g0 }),
  });
  const counts = { skip: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, love: 0 };
  for (let r = 0; r < ds.item.length; r++) {
    counts[ds.rating[r] || 'skip']++;
    counts.love += ds.love[r];
  }
  const byArchetype = {};
  for (const u of ds.users) byArchetype[u.archetype] = (byArchetype[u.archetype] || 0) + 1;
  const generation = {
    users: ds.users.length,
    interactions: ds.item.length,
    archetypes_used: Object.keys(byArchetype).length,
    places: catalog.places.length,
    areas: Object.fromEntries(Object.entries(catalog.byArea).map(([a, v]) => [a, v.length])),
    rating_counts: counts,
    users_per_archetype: byArchetype,
    ms: Date.now() - g0,
  };
  emit({ type: 'log', text: `Generated ${generation.users.toLocaleString()} synthetic users with ${generation.interactions.toLocaleString()} total interactions (${generation.archetypes_used} archetypes, ${generation.places.toLocaleString()} real places)` });

  if (!noDataFiles) emit({ type: 'log', text: 'Writing output/synthetic-users.json and output/synthetic-interactions.json' });
  if (!noDataFiles) await writeJsonArray(path.join(OUT_DIR, 'synthetic-users.json'), ds.users, (u) => {
    const { n: _n, ...profile } = u;
    return profile;
  });
  const rowsIter = function* () {
    for (let r = 0; r < ds.item.length; r++) yield r;
  };
  const place = (r) => catalog.places[ds.item[r]];
  const rowJson = (r) => {
    const u = ds.users[ds.user[r]];
    return { user_id: u.user_id, archetype: u.archetype, landmark_id: `${place(r).region}/${place(r).id}`, landmark_name: place(r).name, rating: ds.rating[r] || null, love: ds.love[r] === 1, skip: ds.rating[r] === 0, step: r - ds.start[ds.user[r]] };
  };
  if (!noDataFiles) await writeJsonArray(path.join(OUT_DIR, 'synthetic-interactions.json'), rowsIter(), rowJson, (k) => emit({ type: 'generation-write', file: 'synthetic-interactions.json', rows: k, total: ds.item.length }));

  // ---- 2. Firestore Emulator (optional, local only) ----------------------
  const db = emulatorDb();
  if (db && (await emulatorReachable())) {
    emit({ type: 'log', text: `Firestore Emulator at ${process.env.FIRESTORE_EMULATOR_HOST}: writing mapr_synthetic_train` });
    const e0 = Date.now();
    await writeCollection(db, 'mapr_synthetic_train', rowsIter(), (r) => [`${ds.users[ds.user[r]].user_id}_${String(r - ds.start[ds.user[r]]).padStart(2, '0')}`, rowJson(r)], {
      onProgress: (done) => emit({ type: 'emulator-write', collection: 'mapr_synthetic_train', done, total: ds.item.length, elapsed_ms: Date.now() - e0 }),
    });
    generation.emulator = { host: process.env.FIRESTORE_EMULATOR_HOST, docs: ds.item.length, ms: Date.now() - e0 };
  } else {
    generation.emulator = null;
    emit({ type: 'log', text: 'No Firestore Emulator running (FIRESTORE_EMULATOR_HOST unset or unreachable): JSON files only. See emulator-setup.sh.' });
  }
  emit({ type: 'generation-done', generation });

  // ---- 3. Monte Carlo training ---------------------------------------------
  emit({ type: 'phase', phase: 'training' });
  const results = await runMonteCarlo({ blendWeights, coldOffset, extended, labBlend, exportFrom: { batch: batches.at(-1).name, sim: 1 }, lab: true, sims: nSims, batches, workers, ncfConfig, outDir: OUT_DIR, emit });

  // ---- 4. Reports ------------------------------------------------------------
  const summary = writeReports(OUT_DIR, results, { config, generation });
  summary.total_ms = Date.now() - t0;
  if (db && generation.emulator) {
    for (const [batch, runs] of Object.entries(results)) {
      await writeCollection(db, `mapr_batch_${batch.toLowerCase()}_results`, runs, (r) => [`sim-${r.sim}`, JSON.parse(JSON.stringify({ ...r, archetypes: null }))]);
    }
    emit({ type: 'log', text: 'Batch results written to mapr_batch_{a,b,c}_results in the emulator' });
  }
  emit({ type: 'phase', phase: 'done' });
  emit({ type: 'summary', summary });
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opt = parseArgs();
  runPipeline({
    ...opt,
    emit: eventLogger((e) => {
      if (e.type === 'log') console.log(e.text);
      else if (e.type === 'epoch' && (e.row.epoch % 10 === 0 || e.row.epoch === 1)) console.log(`[${e.job.id}] Epoch ${e.row.epoch}: loss=${e.row.trainLoss.toFixed(4)} val_loss=${e.row.valLoss.toFixed(4)} val_acc=${(e.row.valAccuracy * 100).toFixed(1)}%`);
      else if (e.type === 'job-done') console.log(`[${e.job.id}] done: NCF accuracy ${(e.result.rankers.ncf.accuracy * 100).toFixed(1)}%, Mapr blend ${(e.result.rankers.mapr.accuracy * 100).toFixed(1)}%, tag+similarity ${(e.result.rankers.tag_sim.accuracy * 100).toFixed(1)}%`);
      else if (e.type === 'summary') console.log(JSON.stringify(e.summary.verdict, null, 1));
    }),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
