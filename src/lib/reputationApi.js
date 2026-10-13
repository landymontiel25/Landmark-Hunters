import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Levels and badges (reputation/{uid}, signed-in read, server-written), and
// the "Trusted in {city}" board (api/reputation-board.js). Phase 4.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export function getReputation(uid, { nowMs = Date.now() } = {}) {
  if (!db || !uid) return Promise.resolve(null);
  const hit = cache.get(uid);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.promise;
  const promise = getDoc(doc(db, 'reputation', uid))
    .then((s) => (s.exists() ? s.data() : null))
    .catch(() => {
      if (cache.get(uid)?.promise === promise) cache.delete(uid);
      return null;
    });
  cache.set(uid, { at: nowMs, promise });
  return promise;
}

export async function fetchReputationBoard(region, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}/api/reputation-board?region=${encodeURIComponent(region)}`, { headers: await authHeaders() });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Could not load the board.'), { status: r.status });
  return out.entries || [];
}

export const _resetReputationCache = () => cache.clear();
