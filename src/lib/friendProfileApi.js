import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// A friend's full profile (screens/FriendProfile.jsx): the two things the
// server does for it (api/friend-profile.js).

async function call(body, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}/api/friend-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: r.status, code: out.code || null, userMessage: out.error || null });
  return out;
}

// { soloStreak: { count, lastCompletedDay, frozenDays } | null, private? }.
// Throws code 'unavailable' for a non-friend, a block either way or a
// missing account.
export const getFriendSoloStreak = (uid, opts) => call({ action: 'solo-streak', uid }, opts);
// Ends the friendship both ways.
export const removeFriend = (uid, opts) => call({ action: 'unfriend', uid }, opts);
