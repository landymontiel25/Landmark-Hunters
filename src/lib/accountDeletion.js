import { doc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { deleteMyReview } from './reviews';

async function deletePhotoSafe(url) {
  if (!storage || !url) return;
  try {
    await deleteObject(ref(storage, url));
  } catch {
    /* already gone, or not a Storage URL -- best-effort only */
  }
}

async function deleteAll(snap) {
  for (const d of snap.docs) {
    try {
      await deleteDoc(d.ref);
    } catch {
      /* best-effort -- account deletion shouldn't get stuck on one doc */
    }
  }
}

/**
 * Best-effort cleanup of everything this account owns in Firestore/Storage,
 * run right before the Firebase Auth user itself is deleted (deleteAccount
 * in AuthContext). Check-ins can't be deleted outright -- firestore.rules
 * locks them permanently (allow delete: if false, kept that way so
 * leaderboard totals can't be tampered with after the fact) -- so those are
 * scrubbed of their two identifying fields instead (userName, photoURL),
 * which is exactly what the checkins update rule already lets an owner
 * change. Landmark submissions and the reverse half of a friend edge
 * (owned by the *other* user) are left alone: removing them would delete
 * content or relationships someone else still sees, and this account has
 * no rule-granted way to touch the friend's own copy of the edge anyway.
 */
export async function deleteAccountData(uid) {
  if (!db) return;

  const userSnap = await getDoc(doc(db, 'users', uid));
  const username = userSnap.exists() ? userSnap.data().username : null;

  const reviewSnap = await getDocs(query(collection(db, 'reviews'), where('userId', '==', uid)));
  for (const d of reviewSnap.docs) {
    const { landmarkId, photoURLs, photoURL } = d.data();
    try {
      await deleteMyReview(uid, landmarkId);
    } catch {
      /* best-effort */
    }
    for (const u of photoURLs?.length ? photoURLs : photoURL ? [photoURL] : []) {
      await deletePhotoSafe(u);
    }
  }

  const checkinSnap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', uid)));
  for (const d of checkinSnap.docs) {
    const { photoURL, photoURLs } = d.data();
    const gallery = Array.isArray(photoURLs) ? photoURLs : [];
    try {
      // photoURLs is the check-in's photo gallery (addCheckinPhoto); the rules
      // let the owner change exactly userName / photoURL / photoURLs.
      await updateDoc(d.ref, {
        userName: 'Deleted User',
        photoURL: null,
        ...(gallery.length ? { photoURLs: [] } : {}),
      });
    } catch {
      /* best-effort */
    }
    await deletePhotoSafe(photoURL);
    for (const u of gallery) await deletePhotoSafe(u);
  }

  await deleteAll(await getDocs(query(collection(db, 'leaderboard_entries'), where('userId', '==', uid))));
  await deleteAll(await getDocs(query(collection(db, 'friend_requests'), where('from', '==', uid))));
  await deleteAll(await getDocs(query(collection(db, 'friend_requests'), where('to', '==', uid))));
  await deleteAll(await getDocs(query(collection(db, 'friend_edges'), where('owner', '==', uid))));
  await deleteAll(await getDocs(query(collection(db, 'blocks'), where('blockerUid', '==', uid))));
  // Newer collection: if its rules aren't deployed yet, don't stop the rest.
  await deleteAll(
    await getDocs(query(collection(db, 'recommendation_log'), where('userId', '==', uid))).catch(() => ({ docs: [] }))
  );

  if (username) {
    try {
      await deleteDoc(doc(db, 'usernames', username));
    } catch {
      /* best-effort */
    }
  }
  // The owner-only private doc (email, home, location, push tokens) is a
  // subcollection doc, so deleting users/{uid} does not remove it.
  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'main'));
  } catch {
    /* best-effort */
  }
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch {
    /* best-effort */
  }
}
