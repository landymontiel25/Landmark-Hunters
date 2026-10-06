import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeNeighbors } from '../src/lib/maprRank/similarity.js';

// Uploads the synthetic-trained models to production Firestore
// (landmark-hunters-284ab) as mapr_pretrained_*. DRY RUN unless --confirm.
//
//   node deploy-to-production.js             prints what it would write
//   FIREBASE_SERVICE_ACCOUNT='{...}' node deploy-to-production.js --confirm
//
// What goes up, and what never does:
//   mapr_pretrained_ncf_model/meta           MLP weights + config + evaluation
//   mapr_pretrained_ncf_model/items-<k>      landmark embeddings, chunked under 1 MB
//   mapr_pretrained_similarity_matrix/<region>  production format (encodeNeighbors)
//   mapr_pretrained_tag_scores/{feature_lift, archetype_priors, place_popularity}
//   Synthetic user embeddings are NOT uploaded: they describe people who do
//   not exist and no real user can use them.
//
// Nothing in the app or the nightly job reads mapr_pretrained_* yet. Using
// them (warm-starting the weekly NCF from these weights, folding new users in)
// is a separate change that has to go to every Mapr surface (CLAUDE.md) and
// is listed in docs/open-work.md.

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'output');
const PROJECT = 'landmark-hunters-284ab';
const ITEMS_PER_DOC = 600;
const confirm = process.argv.includes('--confirm');

const load = (f) => JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));

function plan() {
  const ncf = load('trained-ncf-model.json');
  const sim = load('trained-similarity-matrix.json');
  const tags = load('trained-tag-scores.json');
  const docs = [];
  const { items, layers, dim, hidden, ...rest } = ncf.shared;
  const keys = Object.keys(items);
  docs.push(['mapr_pretrained_ncf_model', 'meta', { status: 'ready_for_production', trainedOn: 'synthetic', dim, hidden, layers, meta: rest, training: { ...ncf.training, history: undefined }, evaluation: ncf.evaluation, itemDocs: Math.ceil(keys.length / ITEMS_PER_DOC), items: keys.length }]);
  for (let k = 0; k * ITEMS_PER_DOC < keys.length; k++) {
    docs.push(['mapr_pretrained_ncf_model', `items-${k}`, { items: Object.fromEntries(keys.slice(k * ITEMS_PER_DOC, (k + 1) * ITEMS_PER_DOC).map((key) => [key, items[key]])) }]);
  }
  for (const [region, neighbors] of Object.entries(sim.regions)) {
    const { json, keptPerRow } = encodeNeighbors(neighbors);
    docs.push(['mapr_pretrained_similarity_matrix', region, { status: 'ready_for_production', trainedOn: 'synthetic', neighbors: json, keptPerRow, stats: sim.stats[region] }]);
  }
  docs.push(['mapr_pretrained_tag_scores', 'feature_lift', { status: 'ready_for_production', trainedOn: 'synthetic', rows: tags.feature_lift }]);
  docs.push(['mapr_pretrained_tag_scores', 'archetype_priors', { trainedOn: 'synthetic', priors: tags.archetype_priors }]);
  docs.push(['mapr_pretrained_tag_scores', 'place_popularity', { trainedOn: 'synthetic', counts: tags.place_popularity }]);
  return docs;
}

const docs = plan();
for (const [col, id, data] of docs) {
  const bytes = JSON.stringify(data).length;
  console.log(`${col}/${id}  ${(bytes / 1024).toFixed(0)} KB${bytes > 1_000_000 ? '  TOO BIG' : ''}`);
}
if (docs.some(([, , d]) => JSON.stringify(d).length > 1_000_000)) throw new Error('A document is over the 1 MB Firestore limit');
if (!confirm) {
  console.log(`\nDry run: ${docs.length} documents for ${PROJECT}. Nothing was written. Add --confirm to upload.`);
  process.exit(0);
}
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is set: unset it to deploy to production, or this would write to the emulator');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT (the service account JSON) is required');
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (sa.project_id !== PROJECT) throw new Error(`Service account is for ${sa.project_id}, expected ${PROJECT}`);
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: PROJECT }, 'deploy'));
const batch = db.batch();
for (const [col, id, data] of docs) batch.set(db.collection(col).doc(id), { ...JSON.parse(JSON.stringify(data)), deployedAt: FieldValue.serverTimestamp() });
await batch.commit();
console.log(`Wrote ${docs.length} documents to ${PROJECT}.`);
