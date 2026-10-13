import { adminDb } from './firebaseAdmin.js';
import { MODEL_CACHE_MS, MODEL_COLLECTION, NCF, NEIGHBORS_COLLECTION, SIMILARITY_COLLECTION, USER_MODEL_COLLECTION } from '../../src/lib/maprRank/config.js';
import { neighborsFromDoc } from '../../src/lib/maprRank/neighbors.js';
import { communityRegionsOf, computeCommunity } from './communityServer.js';
import { ncfDocFor } from '../../src/lib/maprRank/experiments.js';
import { ncfFromDoc } from '../../src/lib/maprRank/ncf.js';
import { decodeNeighbors } from '../../src/lib/maprRank/similarity.js';

// The Mapr Phase 1 models for server-side ranking (Mapr chat), read with the
// Admin SDK and kept in this function instance's memory for MODEL_CACHE_MS.
// Same shape as the phone's loadMaprModels. Never throws: anything missing
// (no service account, no model yet) is null and ranking falls back.

const cache = new Map();
// Community lifts name people and change with blocks and moderation: 10
// minutes, not the models' MODEL_CACHE_MS.
const COMMUNITY_CACHE_MS = 10 * 60 * 1000;
async function cached(key, load, now) {
  const hit = cache.get(key);
  if (hit && now - hit.at < (key.startsWith('community:') ? COMMUNITY_CACHE_MS : MODEL_CACHE_MS)) return hit.value;
  let value;
  try {
    value = await load();
  } catch {
    // A failed read (network, quota) is not cached: the next request retries
    // instead of ranking without the model for MODEL_CACHE_MS.
    return null;
  }
  cache.set(key, { at: now, value });
  return value;
}

export async function loadServerModels({ uid, regions = [], now = Date.now(), db = null, communityText = false } = {}) {
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
  const launch = uid ? communityRegionsOf(regions) : [];
  const [ncf, signals, user, neighbors, community, ...sims] = await Promise.all([
    (async () => {
      // Mapr v2 users get mapr_models/ncf_v2, falling back to ncf.
      const docName = uid ? ncfDocFor(uid) : NCF.modelDoc;
      const load = (name) => cached(name, async () => ncfFromDoc(await get(MODEL_COLLECTION, name)), now);
      const m = await load(docName);
      return m || docName === NCF.modelDoc ? m : load(NCF.modelDoc);
    })(),
    cached('signals', async () => ({ trending: (await get(MODEL_COLLECTION, 'signals'))?.trending || {} }), now),
    uid ? cached(`user:${uid}`, () => get(USER_MODEL_COLLECTION, uid), now) : null,
    uid ? cached(`neighbors:${uid}`, async () => neighborsFromDoc(await get(NEIGHBORS_COLLECTION, uid)), now) : null,
    // This viewer's community lifts (Phase 3), the same as the phone gets.
    launch.length ? cached(`community:${uid}:${launch.join(',')}:${communityText ? 'text' : ''}`, () => computeCommunity(store, uid, launch, { nowMs: now, withText: communityText }), now) : null,
    ...regions.map((r) => cached(`sim:${r}`, async () => decodeNeighbors((await get(SIMILARITY_COLLECTION, r))?.neighbors), now)),
  ]);
  const similarity = {};
  regions.forEach((r, i) => {
    if (sims[i] && Object.keys(sims[i]).length) similarity[r] = sims[i];
  });
  const emb = ncf?.version ? user?.byVersion?.[ncf.version] : null;
  return { similarity, ncf, signals, userEmbedding: Array.isArray(emb) ? emb : null, serverStagnating: user?.stagnating === true, neighbors: neighbors || null, community: community || null };
}

export const _resetServerModels = () => cache.clear();
