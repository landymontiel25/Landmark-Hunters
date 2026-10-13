import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// The feed (api/feed.js, Phase 6).
async function get(query, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}/api/feed?${query}`, { headers: await authHeaders() });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Could not load the feed.'), { status: r.status });
  return out;
}

export const fetchFeed = (region, opts) => get(`region=${encodeURIComponent(region)}`, opts);

// Which launch cities are past the density gate, once per 10 minutes.
let gateCache = null;
export function fetchFeedGate({ nowMs = Date.now(), ...opts } = {}) {
  if (gateCache && nowMs - gateCache.at < 10 * 60 * 1000) return gateCache.promise;
  const promise = get('gate=1', opts)
    .then((o) => o.open || {})
    .catch(() => {
      if (gateCache?.promise === promise) gateCache = null;
      return {};
    });
  gateCache = { at: nowMs, promise };
  return promise;
}
export const _resetFeedGate = () => {
  gateCache = null;
};
