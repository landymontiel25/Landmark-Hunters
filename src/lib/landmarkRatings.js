import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Client side of api/landmark-ratings.js (docs/ratings.md). Google's and
// Tripadvisor's terms forbid caching ratings and reviews, so nothing is
// written to storage: real answers stay in this module's memory while the
// app is open (`remembered` below) and are gone on reload: only a request already in flight is shared (two
// rows for the same landmark make one call). At most 12 run at once so a
// long list never floods the network, and a 401/429/503 pauses new calls
// for a minute.

// 24 at once: Top Landmarks looks up a whole city (up to 120 places) on its
// first open, so twice the old 12 halves the wait for its order.
// How long a screen waits before it looks anything up (owner, 2026-11-10).
export const LOOKUP_DELAY_MS = 500;
const MAX_CONCURRENT = 24;
const PAUSE_MS = 60 * 1000;

const inFlight = new Map(); // key -> promise
// key -> answer, for as long as the app stays open (memory only, never
// storage). Every surface (the Map's preload, the Landmarks tab, its cards,
// the Map sheet, a place's page) shares it, so each place costs one Google
// lookup per app session instead of one per surface (owner, 2026-11-08:
// the daily lookup cap ran out). Only real answers are kept; a failure is
// asked again.
const remembered = new Map();
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

const EMPTY = { google: null, googleNoRating: false };

// Resolves to { google } (a result or null) plus
// googleNoRating (true only when the server says Google has no rating for the
// place; any failure leaves it false). Never throws.
export function loadLandmarkRatings(landmark, { detail = false, fetchImpl = fetch } = {}) {
  const region = landmark?.regionId ?? landmark?.region;
  const id = landmark?.id;
  if (!region || !id) return Promise.resolve(EMPTY);
  const key = `${region}/${id}|${detail ? 1 : 0}`;
  if (remembered.has(key)) return Promise.resolve(remembered.get(key));
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = new Promise((resolve) => {
    queue.push(async () => {
      try {
        if (Date.now() < pausedUntil) return resolve(EMPTY);
        const headers = await authHeaders();
        if (!headers.Authorization) return resolve(EMPTY); // signed out: no ratings
        // The name and spot let the server match a landmark it has no Google ID
        // for yet (api/_lib/catalogRatingMatch.js).
        const where = Number.isFinite(landmark.lat) && Number.isFinite(landmark.lng) && landmark.name ? { name: landmark.name, lat: String(landmark.lat), lng: String(landmark.lng) } : {};
        const qs = new URLSearchParams({ region, id, ...where, ...(detail ? { detail: '1' } : {}) });
        const r = await fetchImpl(`${API_BASE}/api/landmark-ratings?${qs}`, { headers });
        if ([401, 429, 503].includes(r.status)) pausedUntil = Date.now() + PAUSE_MS;
        if (!r.ok) return resolve(EMPTY);
        const body = await r.json().catch(() => null);
        const answer = {
          google: body?.sources?.google || null,
          googleNoRating: body?.googleNoRating === true,
        };
        if (answer.google || answer.googleNoRating) remembered.set(key, answer);
        resolve(answer);
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
  remembered.clear();
  queue.length = 0;
  active = 0;
  pausedUntil = 0;
}
