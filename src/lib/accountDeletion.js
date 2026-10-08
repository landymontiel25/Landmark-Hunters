import { doc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, deleteField } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { deleteMyReview } from './reviews';
import { deleteProject } from './maprChats';
import { clearPickMarks } from './pickMarks';
import { clearSeen } from './maprRank/seenHistory.js';
import { clearLocalPickFeedback } from './pickFeedback';

async function deletePhotoSafe(url) {
  if (!storage || !url) return;
  try {
    await deleteObject(ref(storage, url));
  } catch {
    /* already gone, or not a Storage URL -- best-effort only */
  }
}

async function safeGetDocs(col, field, op, value) {
  try {
    return await getDocs(query(collection(db, col), where(field, op, value)));
  } catch {
    // Newer collection whose rules aren't deployed yet, or a transient
    // failure: skip it rather than stopping the rest of the wipe.
    return { docs: [] };
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

const deleteWhere = async (col, field, uid) => deleteAll(await safeGetDocs(col, field, '==', uid));

/**
 * Best-effort cleanup of everything this account owns in Firestore/Storage,
 * run right before the Firebase Auth user itself is deleted (deleteAccount
 * in AuthContext). Every step is independent and swallows its own errors so
 * one failure never blocks the rest.
 *
 * Check-ins can't be deleted outright -- firestore.rules locks them
 * permanently (allow delete: if false, kept that way so leaderboard totals
 * can't be tampered with after the fact) -- so those are scrubbed of their
 * identifying fields instead (userName, photoURL, photoURLs) plus the
 * location-derived numbers (distanceMeters, gpsAccuracyMeters), which the
 * checkins update rule lets an owner change or, for the last two, remove.
 *
 * Left alone on purpose (no rule lets this account touch them, or they
 * belong to someone else): the reverse half of a friend edge, notifications
 * this account SENT to others (they carry only the recipient's uid), the
 * referral doc, per-day streak entries (delete: false), and Mapr projects
 * the account merely joined.
 */
export async function deleteAccountData(uid) {
  if (!db) return;

  let username = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    username = userSnap.exists() ? userSnap.data().username : null;
  } catch {
    /* best-effort */
  }

  // Reviews (+ replies and photos)
  for (const d of (await safeGetDocs('reviews', 'userId', '==', uid)).docs) {
    const { landmarkId, photoURLs, photoURL } = d.data();
    try {
      await deleteAll(await getDocs(collection(db, 'reviews', d.id, 'replies')));
    } catch {
      /* best-effort */
    }
    try {
      await deleteMyReview(uid, landmarkId);
    } catch {
      /* best-effort */
    }
    for (const u of photoURLs?.length ? photoURLs : photoURL ? [photoURL] : []) {
      await deletePhotoSafe(u);
    }
  }

  // Check-ins: scrub, never delete (see above).
  for (const d of (await safeGetDocs('checkins', 'userId', '==', uid)).docs) {
    const { photoURL, photoURLs, distanceMeters, gpsAccuracyMeters } = d.data();
    const gallery = Array.isArray(photoURLs) ? photoURLs : [];
    try {
      await updateDoc(d.ref, {
        userName: 'Deleted User',
        photoURL: null,
        ...(gallery.length ? { photoURLs: [] } : {}),
        // Location-derived: removed (firestore.rules lets an owner only
        // remove these, never set them). `verification` carries no position.
        ...(distanceMeters !== undefined ? { distanceMeters: deleteField() } : {}),
        ...(gpsAccuracyMeters !== undefined ? { gpsAccuracyMeters: deleteField() } : {}),
      });
    } catch {
      /* best-effort */
    }
    await deletePhotoSafe(photoURL);
    for (const u of gallery) await deletePhotoSafe(u);
  }

  await deleteWhere('leaderboard_entries', 'userId', uid);
  await deleteWhere('friend_requests', 'from', uid);
  await deleteWhere('friend_requests', 'to', uid);
  await deleteWhere('friend_edges', 'owner', uid);
  await deleteWhere('blocks', 'blockerUid', uid);
  await deleteWhere('pick_feedback', 'userId', uid);
  clearPickMarks(uid); // the on-device pick memory (pickMarks.js)
  clearSeen(uid); // the on-device "times shown" memory (maprRank/seenHistory.js)
  clearLocalPickFeedback(uid); // the device copy of taps and any still waiting to be sent (pickFeedback.js)
  await deleteWhere('planning_events', 'userId', uid);
  await deleteWhere('recommendation_log', 'userId', uid);
  // In-app notifications addressed to this account.
  await deleteWhere('notifications', 'uid', uid);

  // Streaks: a solo streak is streaks/{uid} (memberIds: [uid]); dual streaks
  // list this uid in memberIds. Rules let any member delete the doc.
  await deleteAll(await safeGetDocs('streaks', 'memberIds', 'array-contains', uid));

  // Mapr: projects and chats this account owns. Both lists filter on
  // memberUids, the field firestore.rules checks (an ownerUid filter was
  // refused, so nothing was deleted). Projects go first through
  // deleteProject, which detaches every chat in them like the app's own
  // Delete, so other members' chats aren't left pointing at a missing project.
  for (const d of (await safeGetDocs('mapr_projects', 'memberUids', 'array-contains', uid)).docs) {
    const project = { id: d.id, ...d.data() };
    if (project.ownerUid !== uid) continue;
    try {
      await deleteProject(uid, project);
    } catch {
      /* best-effort */
    }
  }
  const chats = await safeGetDocs('mapr_chats', 'memberUids', 'array-contains', uid);
  await deleteAll({ docs: chats.docs.filter((d) => d.data()?.ownerUid === uid) });

  // Group trips: delete the ones owned; leave the ones joined.
  for (const d of (await safeGetDocs('group_trips', 'memberUids', 'array-contains', uid)).docs) {
    const trip = d.data();
    try {
      if (trip.ownerUid === uid) {
        await deleteDoc(d.ref);
      } else {
        await updateDoc(d.ref, {
          memberUids: (trip.memberUids || []).filter((m) => m !== uid),
          [`memberNames.${uid}`]: deleteField(),
        });
      }
    } catch {
      /* best-effort */
    }
  }

  // Landmarks this account submitted (rules let the creator delete them).
  for (const d of (await safeGetDocs('custom_landmarks', 'createdBy', '==', uid)).docs) {
    const { images } = d.data();
    try {
      await deleteDoc(d.ref);
    } catch {
      continue;
    }
    for (const u of Array.isArray(images) ? images : []) await deletePhotoSafe(u);
  }

  if (username) {
    try {
      await deleteDoc(doc(db, 'usernames', username));
    } catch {
      /* best-effort */
    }
  }
  // Mapr's per-place scores (users/{uid}/place_scores). Subcollection docs
  // outlive users/{uid}, so each one is removed here.
  try {
    await deleteAll(await getDocs(collection(db, 'users', uid, 'place_scores')));
  } catch {
    /* best-effort */
  }
  // The taste score's history (users/{uid}/taste_history), same reason.
  try {
    await deleteAll(await getDocs(collection(db, 'users', uid, 'taste_history')));
  } catch {
    /* best-effort */
  }
  // Mapr's model doc for this user (NCF embedding, stagnation flag), written
  // by the nightly job (mapr_user_models/{uid}).
  try {
    await deleteDoc(doc(db, 'mapr_user_models', uid));
  } catch {
    /* best-effort */
  }
  // The daily open record (users/{uid}/open_days), same reason.
  try {
    await deleteAll(await getDocs(collection(db, 'users', uid, 'open_days')));
  } catch {
    /* best-effort */
  }
  // The owner-only private doc (email, home, location, push tokens) is a
  // subcollection doc, so deleting users/{uid} does not remove it.
  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'main'));
  } catch {
    /* best-effort */
  }
  // users/{uid} also holds push tokens, taste profile and itinerary data.
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch {
    /* best-effort */
  }
}
