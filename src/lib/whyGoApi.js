import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// "Why you need to go" lines for itinerary stops (api/why-go.js). The first
// "Show more" opened on a trip asks for every stop on it in one call; the
// answer is kept in memory and in localStorage for 30 days (it's our own
// text, not Google's), so reopening costs nothing. Resolves to
// { [region/id]: [3 lines] }, empty on any failure, so the card shows its
// honest fallback lines (stopCard.fallbackWhy) instead of waiting.
export const WHY_TIMEOUT_MS = 12000;
const STORE_KEY = 'lh-why-go.v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STOPS = 12;

export const whyKey = (stop) => `${stop?.regionId ?? stop?.region ?? ''}/${stop?.id ?? ''}`;

const memory = new Map();
const inFlight = new Map();

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeStore(add) {
  try {
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(readStore()).filter(([, v]) => now - (v?.at || 0) < TTL_MS));
    for (const [k, lines] of Object.entries(add)) kept[k] = { at: now, lines };
    localStorage.setItem(STORE_KEY, JSON.stringify(kept));
  } catch {
    // Private mode or full storage: memory still holds it this session.
  }
}

function cached(key) {
  if (memory.has(key)) return memory.get(key);
  const hit = readStore()[key];
  if (hit && Date.now() - (hit.at || 0) < TTL_MS && Array.isArray(hit.lines) && hit.lines.length === 3) {
    memory.set(key, hit.lines);
    return hit.lines;
  }
  return null;
}

// Catalog stops only: a place Mapr found on the web has no catalog data for
// the server to ground on.
const askable = (s) => s && !s.external && s.id && (s.regionId ?? s.region);

export async function loadWhyGo(stops, { timeoutMs = WHY_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const list = (stops || []).filter(askable);
  const out = {};
  const missing = [];
  for (const s of list) {
    const k = whyKey(s);
    const hit = cached(k);
    if (hit) out[k] = hit;
    else if (!missing.some((m) => whyKey(m) === k)) missing.push(s);
  }
  // Stops another card already asked for: wait on that call.
  const waits = [];
  const ask = [];
  for (const s of missing) {
    const k = whyKey(s);
    if (inFlight.has(k)) waits.push(inFlight.get(k).then((m) => m[k] && (out[k] = m[k])));
    else ask.push(s);
  }
  for (let i = 0; i < ask.length; i += MAX_STOPS) {
    const batch = ask.slice(i, i + MAX_STOPS);
    const call = fetchBatch(batch, { timeoutMs, fetchImpl }).then((m) => {
      if (Object.keys(m).length) writeStore(m);
      for (const [k, v] of Object.entries(m)) memory.set(k, v);
      return m;
    });
    for (const s of batch) inFlight.set(whyKey(s), call);
    waits.push(
      call
        .then((m) => Object.assign(out, m))
        .finally(() => {
          for (const s of batch) inFlight.delete(whyKey(s));
        }),
    );
  }
  await Promise.all(waits);
  return out;
}

async function fetchBatch(stops, { timeoutMs, fetchImpl }) {
  const headers = await authHeaders();
  if (!headers.Authorization) return {}; // signed out: the fallback lines
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${API_BASE}/api/why-go`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ stops: stops.map((s) => ({ region: s.regionId ?? s.region, id: s.id })) }),
      signal: controller?.signal,
    });
    if (!r.ok) return {};
    const body = await r.json().catch(() => ({}));
    const valid = new Set(stops.map(whyKey));
    return Object.fromEntries(Object.entries(body?.why || {}).filter(([k, v]) => valid.has(k) && Array.isArray(v) && v.length === 3 && v.every((l) => typeof l === 'string')));
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export function _resetWhyGo() {
  memory.clear();
  inFlight.clear();
}
