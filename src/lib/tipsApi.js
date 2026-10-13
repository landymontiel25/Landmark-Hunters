import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// The app's side of the tips endpoints (api/post-tip.js, api/tips.js).
// Every call returns the server's JSON; a failure throws an Error whose
// message is the server's own (already written for people to read).

async function call(path, { method = 'POST', body = null, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: r.status, code: out.code || null, userMessage: out.error || null });
  return out;
}

export const postTip = ({ checkinId, text, tags = [], photoURL = null }, opts) => call('/api/post-tip', { body: { checkinId, text, tags, photoURL }, ...opts });
export const deleteMyTip = (landmarkId, region, opts) => call('/api/post-tip', { body: { action: 'delete', landmarkId, region }, ...opts });
// Account deletion: every tip, mark and report of yours, on the server.
export const deleteAllMyTips = (opts) => call('/api/post-tip', { body: { action: 'delete-mine' }, ...opts });
export const fetchTips = (region, landmarkId, opts) => call(`/api/tips?region=${encodeURIComponent(region)}&landmarkId=${encodeURIComponent(landmarkId)}`, { method: 'GET', ...opts });
export const reactToTip = (tipId, kind, on, opts) => call('/api/tips', { body: { action: 'react', tipId, kind, on }, ...opts });
export const reportTip = (tipId, reason, opts) => call('/api/tips', { body: { action: 'report', tipId, reason }, ...opts });
