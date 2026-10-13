import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Client side of api/landmark-ratings.js (docs/ratings.md). Google's and
// Tripadvisor's terms forbid caching ratings and reviews, so nothing is kept
// after a request settles: only a request already in flight is shared (two
// rows for the same landmark make one call). At most 3 run at once so a
// long list never floods the network, and a 401/429/503 pauses new calls
// for a minute.

const MAX_CONCURRENT = 3;
const PAUSE_MS = 60 * 1000;

const inFlight = new Map(); // key -> promise
let active = 0;
const queue = [];
let pausedUntil = 0;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active += 1;
    job().finally(() => {
      active -= 1;
      pump();
    });
  }
}

const EMPTY = { google: null, tripadvisor: null };

// Resolves to { google, tripadvisor } (each a result or null). Never throws.
export function loadLandmarkRatings(landmark, { detail = false, fetchImpl = fetch } = {}) {
  const region = landmark?.regionId ?? landmark?.region;
  const id = landmark?.id;
  if (!region || !id) return Promise.resolve(EMPTY);
  const key = `${region}/${id}|${detail ? 1 : 0}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = new Promise((resolve) => {
    queue.push(async () => {
      try {
        if (Date.now() < pausedUntil) return resolve(EMPTY);
        const headers = await authHeaders();
        if (!headers.Authorization) return resolve(EMPTY); // signed out: no ratings
        const qs = new URLSearchParams({ region, id, ...(detail ? { detail: '1' } : {}) });
        const r = await fetchImpl(`${API_BASE}/api/landmark-ratings?${qs}`, { headers });
        if ([401, 429, 503].includes(r.status)) pausedUntil = Date.now() + PAUSE_MS;
        if (!r.ok) return resolve(EMPTY);
        const body = await r.json().catch(() => null);
        resolve({ google: body?.sources?.google || null, tripadvisor: body?.sources?.tripadvisor || null });
      } catch {
        resolve(EMPTY);
      }
    });
    pump();
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Tests only.
export function _resetLandmarkRatings() {
  inFlight.clear();
  queue.length = 0;
  active = 0;
  pausedUntil = 0;
}
