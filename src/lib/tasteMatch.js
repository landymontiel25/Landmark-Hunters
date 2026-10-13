import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { NEIGHBORS_COLLECTION } from './maprRank/config.js';
import { neighborScoreOf, neighborsFromDoc, tasteMatchLabel } from './maprRank/neighbors.js';

// "Taste match: High / Some" on someone's profile (Phase 2): read from your
// own neighbors doc (mapr_neighbors/{you}, owner-only), never a number.
// One read per 10 minutes per account.
const CACHE_MS = 10 * 60 * 1000;
let cache = null; // { uid, at, promise }

export function loadMyNeighbors(myUid, { nowMs = Date.now() } = {}) {
  if (!db || !myUid) return Promise.resolve(null);
  if (cache && cache.uid === myUid && nowMs - cache.at < CACHE_MS) return cache.promise;
  const promise = getDoc(doc(db, NEIGHBORS_COLLECTION, myUid))
    .then((s) => (s.exists() ? neighborsFromDoc(s.data()) : null))
    .catch(() => {
      // Retry next time, unless a newer read already replaced this one.
      if (cache?.promise === promise) cache = null;
      return null;
    });
  cache = { uid: myUid, at: nowMs, promise };
  return promise;
}

export async function tasteMatchFor(myUid, otherUid, region = null) {
  if (!myUid || !otherUid || myUid === otherUid) return null;
  return tasteMatchLabel(neighborScoreOf(await loadMyNeighbors(myUid), otherUid, region));
}

export const _resetTasteMatch = () => {
  cache = null;
};
