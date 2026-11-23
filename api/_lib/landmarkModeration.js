import { FieldValue } from 'firebase-admin/firestore';
import { isApprovedLandmark } from '../../src/lib/landmarkApproval.js';

// The owner's approval queue for user-added landmarks (anti-farming item 6),
// shown on the admin dashboard's Content page through api/admin-jobs.js.

const msOf = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : null);

// Submissions waiting: status 'pending' and not grandfathered, oldest first.
export async function landmarksQueue(db) {
  const snap = await db.collection('custom_landmarks').where('status', '==', 'pending').get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => !isApprovedLandmark(l))
    .map((l) => ({
      id: l.id,
      name: l.name || '',
      region: l.region || '',
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      categories: l.categories || [],
      summary: String(l.summary || '').slice(0, 500),
      image: Array.isArray(l.images) ? l.images[0] || null : null,
      createdBy: l.createdBy || null,
      createdAt: msOf(l.createdAt),
    }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return { rows };
}

export const LANDMARK_DECISIONS = ['approve', 'reject'];

export async function moderateLandmark(db, id, decision) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(id) || !LANDMARK_DECISIONS.includes(decision)) {
    return { status: 400, body: { error: 'Bad request.' } };
  }
  const ref = db.collection('custom_landmarks').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: 'No such landmark.' } };
  await ref.update({
    status: decision === 'approve' ? 'approved' : 'rejected',
    moderatedAt: FieldValue.serverTimestamp(),
  });
  return { status: 200, body: { ok: true, id, status: decision === 'approve' ? 'approved' : 'rejected' } };
}
