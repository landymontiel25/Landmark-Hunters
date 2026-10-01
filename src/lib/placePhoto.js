import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';
import { fetchJson } from './friendlyError';

// Client side of the runtime photo fallback (api/place-photo.js, see
// docs/photos.md). Only ever called for a landmark with no image of its own.
//
// Google Maps Platform terms: results live in memory for this page session
// only -- never localStorage/IndexedDB/Firestore -- and expire well before
// the short-lived photo URL could.

const SUCCESS_TTL_MS = 2 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_CONCURRENT = 3;

const cache = new Map(); // key -> { value, expires } | { promise }
let active = 0;
const queue = [];
let pausedUntil = 0;

export function placePhotoKey(l) {
  const lat = Number(l?.lat);
  const lng = Number(l?.lng);
  if (!l?.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${l.name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
}

/** Cached result: {url, attributions} | null (no photo) | undefined (unknown). */
export function peekPlacePhoto(l) {
  const key = placePhotoKey(l);
  const hit = key && cache.get(key);
  if (!hit || !('value' in hit)) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

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

function enqueue(task) {
  return new Promise((resolve) => {
    queue.push(() => task().then(resolve, () => resolve(null)));
    pump();
  });
}

async function request(l) {
  if (Date.now() < pausedUntil) return { value: null, ttl: FAILURE_TTL_MS };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { value: null, ttl: 15_000 };
  const headers = await authHeaders();
  if (!headers.Authorization) return { value: null, ttl: 15_000 }; // signed out: endpoint needs an account
  try {
    const q = new URLSearchParams({ name: l.name, lat: String(l.lat), lng: String(l.lng) });
    const data = await fetchJson(`${API_BASE}/api/place-photo?${q}`, { headers });
    if (!data?.url || !/^https:\/\//.test(data.url)) return { value: null, ttl: SUCCESS_TTL_MS };
    const attributions = (Array.isArray(data.attributions) ? data.attributions : []).filter((a) => a?.name);
    return { value: { url: data.url, attributions }, ttl: SUCCESS_TTL_MS };
  } catch (e) {
    // Back off entirely on auth/rate-limit/unconfigured so a long list can't storm the API.
    if ([401, 429, 503].includes(e?.status)) pausedUntil = Date.now() + 60_000;
    return { value: null, ttl: FAILURE_TTL_MS };
  }
}

/** Fetches (deduped per session, max 3 in flight). Resolves to {url, attributions} or null. Never rejects. */
export function loadPlacePhoto(l) {
  const key = placePhotoKey(l);
  if (!key) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  const cached = peekPlacePhoto(l);
  if (cached !== undefined) return Promise.resolve(cached);

  const promise = enqueue(() => request(l)).then((r) => {
    const out = r?.value ?? null;
    cache.set(key, { value: out, expires: Date.now() + (r?.ttl ?? FAILURE_TTL_MS) });
    return out;
  });
  cache.set(key, { promise });
  return promise;
}

export function resetPlacePhotoCache() {
  cache.clear();
  queue.length = 0;
  pausedUntil = 0;
}
