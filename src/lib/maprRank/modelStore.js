import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FEATURES, MODEL_CACHE_MS, MODEL_COLLECTION, NCF, SIMILARITY_COLLECTION, USER_MODEL_COLLECTION } from './config.js';
import { ncfDocFor } from './experiments.js';
import { ncfFromDoc } from './ncf.js';
import { decodeNeighbors } from './similarity.js';

// Loads what the nightly job publishes (api/mapr-nightly.js) for on-device
// ranking, and keeps it on the device for MODEL_CACHE_MS:
//   similarity   mapr_similarity/{region}   (signed-in read)
//   ncf          mapr_models/ncf, or mapr_models/ncf_v2 for users in the
//                Mapr v2 rollout (signed-in read; falls back to ncf)
//   signals      mapr_models/signals        (signed-in read: check-ins this week per place)
//   userEmbedding mapr_user_models/{uid}    (owner-only read)
// Any doc that is missing or fails to load is just null: ranking falls back
// to the step before (maprRank/rank.js). Never throws.

const CACHE_KEY = (name) => `lh-mapr-model:v1:${name}`;
const memory = new Map();

function readCache(name, nowMs) {
  const m = memory.get(name);
  if (m && nowMs - m.at < MODEL_CACHE_MS) return m;
  try {
    const raw = localStorage.getItem(CACHE_KEY(name));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!Number.isFinite(v?.at) || nowMs - v.at >= MODEL_CACHE_MS) return null;
    memory.set(name, v);
    return v;
  } catch {
    return null;
  }
}

function writeCache(name, value, nowMs) {
  const v = { at: nowMs, value };
  memory.set(name, v);
  try {
    localStorage.setItem(CACHE_KEY(name), JSON.stringify(v));
  } catch {
    /* too big for storage or blocked: memory only */
  }
}

async function cachedDoc(name, path, transform, { nowMs, read }) {
  const hit = readCache(name, nowMs);
  if (hit) return hit.value;
  try {
    const snap = await read(path);
    const value = snap ? transform(snap) : null;
    writeCache(name, value, nowMs);
    return value;
  } catch {
    return null;
  }
}

const defaultRead = async ([col, id]) => {
  if (!db) return null;
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? snap.data() : null;
};

export async function loadMaprModels({ uid, regions = [], nowMs = Date.now(), read = defaultRead, features = FEATURES } = {}) {
  if (!uid) return null;
  const opts = { nowMs, read };
  const docName = ncfDocFor(uid, features);
  const loadNcf = async () => {
    const m = await cachedDoc(docName, [MODEL_COLLECTION, docName], ncfFromDoc, opts);
    return m || docName === NCF.modelDoc ? m : cachedDoc(NCF.modelDoc, [MODEL_COLLECTION, NCF.modelDoc], ncfFromDoc, opts);
  };
  const [ncf, signals, user, ...sims] = await Promise.all([
    loadNcf(),
    cachedDoc('signals', [MODEL_COLLECTION, 'signals'], (d) => ({ trending: d.trending || {} }), opts),
    cachedDoc(`user:${uid}`, [USER_MODEL_COLLECTION, uid], (d) => ({ byVersion: d.byVersion && typeof d.byVersion === 'object' ? d.byVersion : {}, stagnating: d.stagnating === true }), opts),
    ...regions.map((r) => cachedDoc(`sim:${r}`, [SIMILARITY_COLLECTION, r], (d) => decodeNeighbors(d.neighbors), opts)),
  ]);
  const similarity = {};
  regions.forEach((r, i) => {
    if (sims[i]) similarity[r] = sims[i];
  });
  // Only the embedding trained with the live model version fits its landmark
  // embeddings (the doc keeps the last two, so a rollback still finds one).
  const emb = ncf?.version ? user?.byVersion?.[ncf.version] : null;
  const userEmbedding = Array.isArray(emb) ? emb : null;
  return { similarity, ncf, signals, userEmbedding, serverStagnating: user?.stagnating === true };
}

export function _resetModelMemory() {
  memory.clear();
}
