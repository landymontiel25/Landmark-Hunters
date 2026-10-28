import { doc, setDoc, getDocs, deleteDoc, collection, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// Your own record of what you reported (users/{uid}/my_reports, owner-only),
// so Settings can list it. Nobody else can read it, and nothing here tells
// the person you reported. One doc per thing, so reporting it again changes
// nothing. A failed log never fails the report itself.
const safe = (s) => String(s || '').replace(/[/]/g, '_').slice(0, 120);

export const REPORT_KINDS = ['comment', 'tip', 'landmark'];

export async function logMyReport(uid, { kind, targetId, label, landmarkId = null, regionId = null }) {
  if (!db || !uid || !REPORT_KINDS.includes(kind) || !targetId) return;
  try {
    await setDoc(doc(db, 'users', uid, 'my_reports', `${kind}_${safe(targetId)}`), {
      kind,
      targetId: String(targetId).slice(0, 200),
      label: String(label || '').slice(0, 200),
      landmarkId: landmarkId ? String(landmarkId).slice(0, 200) : null,
      regionId: regionId ? String(regionId).slice(0, 80) : null,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* already logged (a second write is refused), or offline */
  }
}

export async function listMyReports(uid) {
  if (!db || !uid) return [];
  const snap = await getDocs(query(collection(db, 'users', uid, 'my_reports'), orderBy('createdAt', 'desc'), limit(50)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function removeMyReportRecord(uid, id) {
  if (!db || !uid || !id) return;
  await deleteDoc(doc(db, 'users', uid, 'my_reports', id));
}
