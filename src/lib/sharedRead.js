// Shares identical Firestore reads that happen close together. On app start
// (and on every screen that mounts several contexts at once) the same
// collection -- a user's check-ins, their reviews, the custom landmarks --
// was fetched 3-5 times in a row, which is slow on cellular and burns reads.
//
// Only reads still in flight are shared (nothing is cached once one settles),
// and any write that could change the result (wrapped with `invalidating`) drops them, so a
// reload after a check-in, rating or edit always sees fresh data.
const cache = new Map();

// Each caller gets its own array so one caller sorting or mutating its result
// can't affect another's.
const own = (v) => (Array.isArray(v) ? v.slice() : v);

export function sharedRead(key, load) {
  const hit = cache.get(key);
  if (hit) return hit.promise.then(own);
  const entry = {};
  entry.promise = Promise.resolve()
    .then(load)
    .finally(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  cache.set(key, entry);
  return entry.promise.then(own);
}

export function invalidateReads() {
  cache.clear();
}

// Wraps a function that writes data some shared read covers: reads in flight
// when it finishes (success or failure) are dropped so the next one is fresh.
export function invalidating(fn) {
  return async function invalidatingWrapper(...args) {
    try {
      return await fn(...args);
    } finally {
      invalidateReads();
    }
  };
}
