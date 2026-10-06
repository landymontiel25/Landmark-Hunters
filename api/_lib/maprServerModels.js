import { adminDb } from './firebaseAdmin.js';
import { MODEL_CACHE_MS, MODEL_COLLECTION, SIMILARITY_COLLECTION, USER_MODEL_COLLECTION } from '../../src/lib/maprRank/config.js';
import { decodeNeighbors } from '../../src/lib/maprRank/similarity.js';

// The Mapr Phase 1 models for server-side ranking (Mapr chat), read with the
// Admin SDK and kept in this function instance's memory for MODEL_CACHE_MS.
// Same shape as the phone's loadMaprModels. Never throws: anything missing
// (no service account, no model yet) is null and ranking falls back.

const cache = new Map();
async function cached(key, load, now) {
  const hit = cache.get(key);
  if (hit && now - hit.at < MODEL_CACHE_MS) return hit.value;
  const value = await load().catch(() => null);
  cache.set(key, { at: now, value });
  return value;
}

export async function loadServerModels({ uid, regions = [], now = Date.now(), db = null } = {}) {
  let store;
  try {
    store = db || adminDb();
  } catch {
    return null;
  }
  const get = async (col, id) => {
    const snap = await store.collection(col).doc(id).get();
    return snap.exists ? snap.data() : null;
  };
  const [ncf, signals, user, ...sims] = await Promise.all([
    cached('ncf', async () => {
      const d = await get(MODEL_COLLECTION, 'ncf');
      return d?.layers && d?.items ? { dim: d.dim, layers: d.layers, items: d.items, version: d.version ?? null, active: d.active === true } : null;
    }, now),
    cached('signals', async () => ({ trending: (await get(MODEL_COLLECTION, 'signals'))?.trending || {} }), now),
    uid ? cached(`user:${uid}`, () => get(USER_MODEL_COLLECTION, uid), now) : null,
    ...regions.map((r) => cached(`sim:${r}`, async () => decodeNeighbors((await get(SIMILARITY_COLLECTION, r))?.neighbors), now)),
  ]);
  const similarity = {};
  regions.forEach((r, i) => {
    if (sims[i] && Object.keys(sims[i]).length) similarity[r] = sims[i];
  });
  const emb = ncf?.version ? user?.byVersion?.[ncf.version] : null;
  return { similarity, ncf, signals, userEmbedding: Array.isArray(emb) ? emb : null, serverStagnating: user?.stagnating === true };
}

export const _resetServerModels = () => cache.clear();
