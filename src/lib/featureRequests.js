import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { notifyUser } from './notifications';
import { findAdminUid } from './friends';
import { ADMIN_EMAILS } from './admins';

// "Request a Feature" on Profile -- anyone signed in can suggest something,
// and the admin gets an in-app notification plus a spot to approve/reject it
// on the same screen's second tab. Modeled on custom_landmarks' pending-
// review pattern (submit as "pending", admin flips the status).

export async function submitFeatureRequest({ userId, userName, title, description, reason }) {
  const data = {
    userId,
    userName: userName || 'Explorer',
    title: title.trim().slice(0, 80),
    description: description.trim().slice(0, 1000),
    reason: reason.trim().slice(0, 1000),
    status: 'pending',
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'feature_requests'), data);
  // Best-effort -- a submission that succeeds shouldn't fail just because
  // the admin notification couldn't be created (e.g. the admin's own users/
  // doc hasn't synced an email yet).
  try {
    const adminUid = await findAdminUid(ADMIN_EMAILS[0]);
    if (adminUid) {
      await notifyUser(adminUid, {
        type: 'feature_request',
        message: `\u{1F4A1} New feature request from ${data.userName}: "${data.title}"`,
        featureRequestId: ref.id,
      });
    }
  } catch {
    /* the request itself already saved -- a missing notification isn't fatal */
  }
  return { id: ref.id, ...data };
}

export async function getPendingFeatureRequests() {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'feature_requests'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

// Only an admin account can call these -- the Firestore rules enforce that
// independently of this client code.
export async function approveFeatureRequest(id) {
  await updateDoc(doc(db, 'feature_requests', id), { status: 'approved' });
}

export async function rejectFeatureRequest(id) {
  await updateDoc(doc(db, 'feature_requests', id), { status: 'rejected' });
}
