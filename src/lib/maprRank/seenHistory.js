import { EXPLORATION } from './config.js';

// How many times each place has been shown to this user as a pick, on this
// device: { [landmarkId]: { count, firstShownAt, lastShownAt } }. Novelty
// (exploration.js) and the skip rate behind epsilon read it. Updated once per
// built set per place (logShownPicks already dedupes). Bounded, oldest out.

const KEY = (uid) => `lh-mapr-seen:v1:${uid}`;
const store = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function readSeen(uid, storage = store()) {
  if (!uid || !storage) return {};
  try {
    const v = JSON.parse(storage.getItem(KEY(uid)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function recordSeen(uid, stops, at = Date.now(), storage = store(), limit = EXPLORATION.seenMemoryLimit) {
  if (!uid || !storage || !stops?.length) return;
  const map = readSeen(uid, storage);
  for (const s of stops) {
    if (!s?.id) continue;
    const prev = map[s.id];
    map[s.id] = { count: (prev?.count || 0) + 1, firstShownAt: prev?.firstShownAt ?? at, lastShownAt: at };
  }
  const kept = Object.entries(map).sort((a, b) => (a[1].lastShownAt || 0) - (b[1].lastShownAt || 0)).slice(-limit);
  try {
    storage.setItem(KEY(uid), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or blocked: novelty just reads everything as unseen */
  }
}

export function clearSeen(uid, storage = store()) {
  try {
    storage?.removeItem(KEY(uid));
  } catch {
    /* ignore */
  }
}
