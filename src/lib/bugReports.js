import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { notifyUser } from './notifications';
import { findAdminUid } from './friends';
import { ADMIN_EMAILS } from './admins';

// Settings' "Report a Bug" -- same pending-review shape as
// featureRequests.js's "Request a Feature": anyone signed in can submit
// one (always starting "pending"), the admin gets an in-app notification,
// and only the submitter or an admin can read it back / flip its status.

export async function submitBugReport({ userId, userName, title, description, steps }) {
  const data = {
    userId,
    userName: userName || 'Explorer',
    title: title.trim().slice(0, 80),
    description: description.trim().slice(0, 1000),
    steps: steps.trim().slice(0, 1000),
    status: 'pending',
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'bug_reports'), data);
  // Best-effort -- a submission that succeeds shouldn't fail just because
  // the admin notification couldn't be created (e.g. the admin's own users/
  // doc hasn't synced an email yet).
  try {
    const adminUid = await findAdminUid(ADMIN_EMAILS[0]);
    if (adminUid) {
      await notifyUser(adminUid, {
        type: 'bug_report',
        message: `\u{1F41B} New bug report from ${data.userName}: "${data.title}"`,
        bugReportId: ref.id,
      });
    }
  } catch {
    /* the report itself already saved -- a missing notification isn't fatal */
  }
  return { id: ref.id, ...data };
}

export async function getPendingBugReports() {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'bug_reports'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

// Only an admin account can call these -- the Firestore rules enforce that
// independently of this client code.
export async function resolveBugReport(id) {
  await updateDoc(doc(db, 'bug_reports', id), { status: 'resolved' });
}

export async function dismissBugReport(id) {
  await updateDoc(doc(db, 'bug_reports', id), { status: 'dismissed' });
}
