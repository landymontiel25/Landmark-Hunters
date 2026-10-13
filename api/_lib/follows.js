import { FieldValue } from 'firebase-admin/firestore';
import { deleteRefs, HOUR_MS } from './tipsServer.js';

// Follows (docs/discovery-network-plan.md, Phase 2): one-way, of public
// profiles, no approval. follows/{followerUid}_{followeeUid} is written only
// here (the rules refuse every client write), and so are the counts on
// users/{uid}: followerCount, followingCount. Server-only beside it:
// follow_log/{uid}, the hourly count of new follows.

export const FOLLOW_RATE_LIMIT = 60; // new follows an hour
export const followId = (follower, followee) => `${follower}_${followee}`;

const usersRef = (db, uid) => db.collection('users').doc(uid);
const countOf = (snap, field) => Math.max(0, Number(snap.exists ? snap.data()?.[field] : 0) || 0);

// Why `follower` may not follow `followee`, or null. Reads inside the
// transaction so a block or a switch to private made meanwhile counts.
async function followProblem(tx, db, follower, followee) {
  if (follower === followee) return [400, { error: "You can't follow yourself.", code: 'self' }];
  const [target, b1, b2] = await Promise.all([
    tx.get(usersRef(db, followee)),
    tx.get(db.collection('blocks').doc(`${follower}_${followee}`)),
    tx.get(db.collection('blocks').doc(`${followee}_${follower}`)),
  ]);
  // A block reads the same as a missing account: no hint who blocked whom.
  if (!target.exists || b1.exists || b2.exists) return [404, { error: 'That account is not available.', code: 'unavailable' }];
  if (target.data()?.public !== true) return [403, { error: 'Only public profiles can be followed.', code: 'private' }];
  return null;
}

export async function follow(db, follower, followee, { nowMs = Date.now() } = {}) {
  const ref = db.collection('follows').doc(followId(follower, followee));
  const logRef = db.collection('follow_log').doc(follower);
  return db.runTransaction(async (tx) => {
    const [cur, log, me] = await Promise.all([tx.get(ref), tx.get(logRef), tx.get(usersRef(db, follower))]);
    if (cur.exists) return [200, { ok: true, following: true }];
    const problem = await followProblem(tx, db, follower, followee);
    if (problem) return problem;
    const recent = (log.exists ? log.data().at || [] : []).filter((t) => nowMs - t < HOUR_MS);
    if (recent.length >= FOLLOW_RATE_LIMIT) return [429, { error: 'You followed a lot of people in the last hour. Try again later.', code: 'rate' }];
    const them = await tx.get(usersRef(db, followee));
    tx.set(ref, { followerUid: follower, followeeUid: followee, createdAtMs: nowMs, createdAt: FieldValue.serverTimestamp() });
    tx.set(logRef, { at: [...recent, nowMs] });
    tx.set(usersRef(db, followee), { followerCount: countOf(them, 'followerCount') + 1 }, { merge: true });
    tx.set(usersRef(db, follower), { followingCount: countOf(me, 'followingCount') + 1 }, { merge: true });
    return [200, { ok: true, following: true }];
  });
}

// Removes one follow and takes it off both counts (never below 0). A user
// doc that no longer exists (a deleted account) is left alone.
export async function unfollow(db, follower, followee) {
  const ref = db.collection('follows').doc(followId(follower, followee));
  return db.runTransaction(async (tx) => {
    const [cur, me, them] = await Promise.all([tx.get(ref), tx.get(usersRef(db, follower)), tx.get(usersRef(db, followee))]);
    if (!cur.exists) return [200, { ok: true, following: false }];
    tx.delete(ref);
    if (them.exists) tx.set(usersRef(db, followee), { followerCount: Math.max(0, countOf(them, 'followerCount') - 1) }, { merge: true });
    if (me.exists) tx.set(usersRef(db, follower), { followingCount: Math.max(0, countOf(me, 'followingCount') - 1) }, { merge: true });
    return [200, { ok: true, following: false }];
  });
}

// A block removes follows both ways. Called right after a block (by either
// person, who must be one side of it) and nightly for any it missed.
export async function removeFollowsBetween(db, a, b) {
  await unfollow(db, a, b);
  await unfollow(db, b, a);
}

// Account deletion: every follow from and to this account, with the other
// side's count fixed.
export async function deleteMyFollows(db, uid) {
  const [out, inc] = await Promise.all([
    db.collection('follows').where('followerUid', '==', uid).get(),
    db.collection('follows').where('followeeUid', '==', uid).get(),
  ]);
  for (const d of out.docs) await unfollow(db, uid, d.data().followeeUid);
  for (const d of inc.docs) await unfollow(db, d.data().followerUid, uid);
  return out.size + inc.size;
}

// Nightly: follows across a block, or from or to a deleted account, are
// removed, then every count is set from
// the follows themselves, so a failed write never leaves a count wrong for
// long. Skips the recount past `max` follows (it would need paging).
export async function followUpkeep(db, { max = 20000 } = {}) {
  const blocks = await db.collection('blocks').get();
  let unblocked = 0;
  for (const d of blocks.docs) {
    const { blockerUid: a, blockedUid: b } = d.data() || {};
    if (!a || !b) continue;
    const [x, y] = await db.getAll(db.collection('follows').doc(followId(a, b)), db.collection('follows').doc(followId(b, a)));
    if (x.exists || y.exists) {
      await removeFollowsBetween(db, a, b);
      unblocked++;
    }
  }
  const snap = await db.collection('follows').select('followerUid', 'followeeUid').limit(max + 1).get();
  if (snap.size > max) return { unblocked, recounted: 0, orphans: 0, follows: snap.size };
  // Follows from or to an account that's gone (its deletion couldn't reach
  // the server) are deleted, and don't count.
  const people = [...new Set(snap.docs.flatMap((d) => [d.data().followerUid, d.data().followeeUid]))].filter(Boolean);
  const gone = new Set();
  for (let i = 0; i < people.length; i += 300) {
    const docs = await db.getAll(...people.slice(i, i + 300).map((u) => usersRef(db, u)));
    docs.forEach((s, j) => {
      if (!s.exists) gone.add(people[i + j]);
    });
  }
  const orphans = snap.docs.filter((d) => gone.has(d.data().followerUid) || gone.has(d.data().followeeUid));
  await deleteRefs(db, orphans.map((d) => d.ref));
  const followers = new Map();
  const following = new Map();
  for (const d of snap.docs) {
    const { followerUid, followeeUid } = d.data();
    if (gone.has(followerUid) || gone.has(followeeUid)) continue;
    followers.set(followeeUid, (followers.get(followeeUid) || 0) + 1);
    following.set(followerUid, (following.get(followerUid) || 0) + 1);
  }
  // Everyone with a count today or a follow: those are the only docs that
  // can be wrong.
  const [hasFollowers, hasFollowing] = await Promise.all([
    db.collection('users').where('followerCount', '>', 0).select('followerCount').get(),
    db.collection('users').where('followingCount', '>', 0).select('followingCount').get(),
  ]);
  const uids = new Set([...followers.keys(), ...following.keys(), ...hasFollowers.docs.map((d) => d.id), ...hasFollowing.docs.map((d) => d.id)]);
  const ids = [...uids];
  let recounted = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((u) => usersRef(db, u));
    const docs = await db.getAll(...refs);
    const batch = db.batch();
    let n = 0;
    docs.forEach((s, j) => {
      if (!s.exists) return;
      const uid = ids[i + j];
      const want = { followerCount: followers.get(uid) || 0, followingCount: following.get(uid) || 0 };
      if (countOf(s, 'followerCount') !== want.followerCount || countOf(s, 'followingCount') !== want.followingCount) {
        batch.set(refs[j], want, { merge: true });
        n++;
      }
    });
    if (n) await batch.commit();
    recounted += n;
  }
  return { unblocked, recounted, orphans: orphans.length, follows: snap.size };
}
