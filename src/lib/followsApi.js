import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Follows (docs/discovery-network-plan.md, Phase 2): one-way, of public
// profiles. The server (api/follow.js) makes and removes them and keeps
// the counts on users/ (followerCount, followingCount); the app only reads
// the follows it made or got (firestore.rules).

async function call(body, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}/api/follow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: r.status, code: out.code || null, userMessage: out.error || null });
  return out;
}

export const followUser = (uid, opts) => call({ action: 'follow', uid }, opts);
export const unfollowUser = (uid, opts) => call({ action: 'unfollow', uid }, opts);
// After a block, either way: the follows between the two go. Best effort;
// the nightly job removes any it missed.
export const followsBlocked = (uid, opts) => call({ action: 'blocked', uid }, opts);
// Account deletion: every follow from and to you.
export const deleteAllMyFollows = (opts) => call({ action: 'delete-mine' }, opts);

export async function isFollowing(myUid, uid) {
  if (!db || !myUid || !uid || myUid === uid) return false;
  const snap = await getDoc(doc(db, 'follows', `${myUid}_${uid}`));
  return snap.exists();
}

// The people you follow, newest first: [{ uid, createdAtMs }].
export async function listMyFollowing(myUid) {
  if (!db || !myUid) return [];
  const snap = await getDocs(query(collection(db, 'follows'), where('followerUid', '==', myUid)));
  return snap.docs.map((d) => ({ uid: d.data().followeeUid, createdAtMs: d.data().createdAtMs || 0 })).sort((a, b) => b.createdAtMs - a.createdAtMs);
}
