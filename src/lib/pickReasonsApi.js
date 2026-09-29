import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';
import { pickKey } from './nearbyPicks';

// The one call that writes the picks' one-line reasons (api/pick-reasons.js).
// Resolves to { [pickKey]: line } -- empty on any failure or timeout, so the
// caller falls back to the plain line (nearbyPicks.withReasons) instead of
// waiting on a spinner.
export const REASONS_TIMEOUT_MS = 6000;

export async function fetchPickReasons(picks, { timeoutMs = REASONS_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!picks?.length) return {};
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${API_BASE}/api/pick-reasons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        picks: picks.map((p) => ({
          region: p.region,
          id: p.id,
          pickType: p.pickType || 'usual',
          chainFrom: p.chain?.from || null,
        })),
      }),
      signal: controller?.signal,
    });
    if (!r.ok) return {};
    const body = await r.json().catch(() => ({}));
    const valid = new Set(picks.map(pickKey));
    return Object.fromEntries(Object.entries(body?.reasons || {}).filter(([k, v]) => valid.has(k) && typeof v === 'string'));
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
