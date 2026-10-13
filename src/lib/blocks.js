import { doc, setDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { settleWrite } from './offlineWrite';
import { followsBlocked } from './followsApi';

// Blocking is one-directional (you stop seeing them) but enforced both ways
// in firestore.rules -- a block from either side hides that pair's reviews
// from each other and stops either from sending the other a friend request.
export async function blockUser(blockerUid, blockedUid, blockedName = null) {
  if (!db || !blockerUid || !blockedUid || blockerUid === blockedUid) return;
  const out = await settleWrite(setDoc(doc(db, 'blocks', `${blockerUid}_${blockedUid}`), {
    blockerUid,
    blockedUid,
    blockedName: blockedName || null,
    createdAt: serverTimestamp(),
  }));
  // A block removes follows both ways (the server does it, once it sees the
  // block). Skipped while the block is only queued offline (the server
  // couldn't see it yet); the nightly job catches any missed.
  if (!out?.queued) followsBlocked(blockedUid).catch(() => {});
}

export async function unblockUser(blockerUid, blockedUid) {
  if (!db || !blockerUid || !blockedUid) return;
  await settleWrite(deleteDoc(doc(db, 'blocks', `${blockerUid}_${blockedUid}`)));
}

export async function listBlockedUsers(blockerUid) {
  if (!db || !blockerUid) return [];
  const snap = await getDocs(query(collection(db, 'blocks'), where('blockerUid', '==', blockerUid)));
  return snap.docs.map((d) => d.data());
}
