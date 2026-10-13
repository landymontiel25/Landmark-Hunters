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

// Why `follower` may not follow `followee` ([code, body]), or { target }
// (the followee's user doc). Reads inside the transaction so a block or a
// switch to private made meanwhile counts.
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
  return { target };
}

export async function follow(db, follower, followee, { nowMs = Date.now() } = {}) {
  const ref = db.collection('follows').doc(followId(follower, followee));
  const logRef = db.collection('follow_log').doc(follower);
  return db.runTransaction(async (tx) => {
    const [cur, log, me] = await Promise.all([tx.get(ref), tx.get(logRef), tx.get(usersRef(db, follower))]);
    if (cur.exists) return [200, { ok: true, following: true }];
    const checked = await followProblem(tx, db, follower, followee);
    if (Array.isArray(checked)) return checked;
    const them = checked.target;
    const recent = (log.exists ? log.data().at || [] : []).filter((t) => nowMs - t < HOUR_MS);
    if (recent.length >= FOLLOW_RATE_LIMIT) return [429, { error: 'You followed a lot of people in the last hour. Try again later.', code: 'rate' }];
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

// Account deletion: every follow from and to this account, in batches,
// with one count fix per other person (an account with thousands of
// followers would time out one transaction at a time). The nightly recount
// corrects any count this leaves off.
export async function deleteMyFollows(db, uid) {
  const [out, inc] = await Promise.all([
    db.collection('follows').where('followerUid', '==', uid).get(),
    db.collection('follows').where('followeeUid', '==', uid).get(),
  ]);
  const minus = new Map(); // uid -> { followerCount, followingCount } to take off
  const take = (u, field) => {
    if (!u || u === uid) return;
    const m = minus.get(u) || { followerCount: 0, followingCount: 0 };
    m[field]++;
    minus.set(u, m);
  };
  for (const d of out.docs) take(d.data().followeeUid, 'followerCount');
  for (const d of inc.docs) take(d.data().followerUid, 'followingCount');
  await deleteRefs(db, [...out.docs, ...inc.docs].map((d) => d.ref));
  const others = [...minus.keys()];
  for (let i = 0; i < others.length; i += 300) {
    const refs = others.slice(i, i + 300).map((u) => usersRef(db, u));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let n = 0;
    snaps.forEach((s, j) => {
      if (!s.exists) return;
      const m = minus.get(others[i + j]);
      batch.set(refs[j], { followerCount: Math.max(0, countOf(s, 'followerCount') - m.followerCount), followingCount: Math.max(0, countOf(s, 'followingCount') - m.followingCount) }, { merge: true });
      n++;
    });
    if (n) await batch.commit();
  }
  if (out.size || inc.size) await usersRef(db, uid).get().then((s) => s.exists && usersRef(db, uid).set({ followerCount: 0, followingCount: 0 }, { merge: true }));
  return out.size + inc.size;
}

// Nightly: follows across a block, or from or to a deleted account, are
// removed, then any count that disagrees with the follows is recounted for
// that one person inside a transaction (so a follow made while the job runs
// isn't overwritten by an older snapshot). Skips the recount past `max`
// follows (it would need paging).
export async function followUpkeep(db, { max = 20000 } = {}) {
  const snap = await db.collection('follows').select('followerUid', 'followeeUid').limit(max + 1).get();
  if (snap.size > max) return { unblocked: 0, recounted: 0, orphans: 0, follows: snap.size };
  const pairs = new Set(snap.docs.map((d) => d.id));
  // Blocks matched in memory against the follows already loaded.
  const blocks = await db.collection('blocks').get();
  let unblocked = 0;
  for (const d of blocks.docs) {
    const { blockerUid: a, blockedUid: b } = d.data() || {};
    if (!a || !b || (!pairs.has(followId(a, b)) && !pairs.has(followId(b, a)))) continue;
    await removeFollowsBetween(db, a, b);
    pairs.delete(followId(a, b));
    pairs.delete(followId(b, a));
    unblocked++;
  }
  const live = snap.docs.filter((d) => pairs.has(d.id));
  // Follows from or to an account that's gone (its deletion couldn't reach
  // the server) are deleted, and don't count.
  const people = [...new Set(live.flatMap((d) => [d.data().followerUid, d.data().followeeUid]))].filter(Boolean);
  const gone = new Set();
  for (let i = 0; i < people.length; i += 300) {
    const docs = await db.getAll(...people.slice(i, i + 300).map((u) => usersRef(db, u)));
    docs.forEach((s, j) => {
      if (!s.exists) gone.add(people[i + j]);
    });
  }
  const orphans = live.filter((d) => gone.has(d.data().followerUid) || gone.has(d.data().followeeUid));
  await deleteRefs(db, orphans.map((d) => d.ref));
  const followers = new Map();
  const following = new Map();
  for (const d of live) {
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
  const ids = [...new Set([...followers.keys(), ...following.keys(), ...hasFollowers.docs.map((d) => d.id), ...hasFollowing.docs.map((d) => d.id)])];
  let recounted = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const docs = await db.getAll(...ids.slice(i, i + 300).map((u) => usersRef(db, u)));
    for (let j = 0; j < docs.length; j++) {
      const s = docs[j];
      const uid = ids[i + j];
      if (!s.exists) continue;
      if (countOf(s, 'followerCount') === (followers.get(uid) || 0) && countOf(s, 'followingCount') === (following.get(uid) || 0)) continue;
      await recountOne(db, uid);
      recounted++;
    }
  }
  return { unblocked, recounted, orphans: orphans.length, follows: snap.size };
}

// One person's counts, from their follows, read and written in one
// transaction.
export async function recountOne(db, uid) {
  await db.runTransaction(async (tx) => {
    const [ers, ing, me] = await Promise.all([
      tx.get(db.collection('follows').where('followeeUid', '==', uid)),
      tx.get(db.collection('follows').where('followerUid', '==', uid)),
      tx.get(usersRef(db, uid)),
    ]);
    if (!me.exists) return;
    tx.set(usersRef(db, uid), { followerCount: ers.size, followingCount: ing.size }, { merge: true });
  });
}
