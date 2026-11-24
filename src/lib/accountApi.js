import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Delete Account's server step (api/account.js): removes everything the
// account owns, Mapr chats included, which no client may delete. Throws on
// any failure, so the caller can fall back to its own best-effort wipe.
export async function wipeAccountOnServer({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}/api/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ action: 'wipe' }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.ok) throw Object.assign(new Error(out.error || 'wipe failed'), { status: r.status });
  return out;
}
