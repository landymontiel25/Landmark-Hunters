import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { toMs } from './time.js';
import { deleteRefs, deleteTipPhoto, isFirestoreId } from './tipsServer.js';

// The admin dashboard's Content page (admin-dashboard/app/dashboard/content),
// through api/admin-jobs.js: tips waiting for the owner, and what the owner
// decides. Server only (Admin SDK); no app user can reach it.
//
//   held       the word filter held it; nobody else has seen it
//   reported   live with 1 or more reports (2 hide it)
//   withdrawn  hidden by reports, then deleted by its author; kept for
//              review, and its author can't post there until it's cleared

const QUEUE_LIMIT = 200;
export const TIP_DECISIONS = ['approve', 'remove', 'clear'];

function queueRow(id, t, reports) {
  return {
    id,
    gen: t.gen ?? null,
    authorUid: t.authorUid,
    authorName: t.authorName || null,
    landmarkId: t.landmarkId,
    landmarkName: t.landmarkName || null,
    region: t.region || null,
    text: t.text || '',
    tags: Array.isArray(t.tags) ? t.tags : [],
    photoURL: t.photoURL || null,
    status: t.status,
    hidden: t.hidden === true,
    reportCount: t.reportCount || 0,
    heldReasons: Array.isArray(t.heldReasons) ? t.heldReasons : [],
    // Reasons and times only: the queue doesn't need who reported.
    reports: reports.map((r) => ({ reason: r.reason || 'other', at: r.at ?? null })),
    createdAt: t.createdAtMs ?? toMs(t.createdAt),
    accountDeleted: !!t.accountDeletedAt,
  };
}

export async function tipsQueue(db) {
  // Reported = live with reports (index: status + reportCount), so removed
  // tips with old reports never crowd it out.
  const [held, reported, withdrawn] = await Promise.all([
    db.collection('tips').where('status', '==', 'held').limit(QUEUE_LIMIT).get(),
    db.collection('tips').where('status', '==', 'live').where('reportCount', '>', 0).limit(QUEUE_LIMIT).get(),
    db.collection('tips').where('status', '==', 'withdrawn').limit(QUEUE_LIMIT).get(),
  ]);
  const byId = new Map();
  for (const d of [...held.docs, ...reported.docs, ...withdrawn.docs]) {
    const t = d.data();
    if (t.status === 'removed') continue;
    byId.set(d.id, t);
  }
  const ids = [...byId.keys()];
  // Reports in chunks of 30 tips (Firestore's 'in' limit).
  const reportsOf = new Map(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection('tip_reports').where('tipId', 'in', ids.slice(i, i + 30)).get();
    for (const d of snap.docs) reportsOf.get(d.data().tipId)?.push(d.data());
  }
  const rows = ids.map((id) => {
    const t = byId.get(id);
    const reports = reportsOf.get(id).filter((r) => (r.gen ?? null) === (t.gen ?? null) && !r.resolvedAt);
    return queueRow(id, t, reports);
  });
  const order = { held: 0, withdrawn: 1, live: 2 };
  rows.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.reportCount - a.reportCount || (b.createdAt || 0) - (a.createdAt || 0));
  return {
    rows,
    counts: {
      held: rows.filter((r) => r.status === 'held').length,
      reported: rows.filter((r) => r.status === 'live').length,
      withdrawn: rows.filter((r) => r.status === 'withdrawn').length,
    },
  };
}

// One decision on one tip:
//   approve  held or reported: live again, its reports marked resolved (the
//            count starts over, so it takes 2 new reports to hide it again).
//            Withdrawn: the author had deleted it, so it goes for good and the
//            author may post at that place again.
//   remove   it stays, hidden from everyone with its photo deleted, and its
//            author can never post at that place again
//   clear    deleted for good with its marks, views and photo (reports kept
//            as the record); the author may post there again
export async function moderateTip(db, tipId, decision, { nowMs = Date.now(), gen } = {}) {
  if (!isFirestoreId(tipId)) return { status: 400, body: { error: 'tipId is required.' } };
  if (!TIP_DECISIONS.includes(decision)) return { status: 400, body: { error: 'Unknown decision.' } };
  const ref = db.collection('tips').doc(tipId);
  // One transaction, on the post the owner reviewed (gen): a newer post at
  // the same id, or one changed meanwhile, is never approved or removed
  // unseen.
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 404, body: { error: 'No such tip.' } };
    const t = snap.data();
    if (gen !== undefined && (t.gen ?? null) !== gen) return { status: 409, body: { error: 'This tip changed since the list loaded. Reload and look again.' } };
    if (decision === 'clear' || (decision === 'approve' && t.status === 'withdrawn')) {
      tx.delete(ref);
      return { status: 200, body: { ok: true, result: 'deleted' }, cleanup: t };
    }
    if (decision === 'remove') {
      tx.update(ref, { status: 'removed', hidden: true, photoURL: null, reviewedAt: nowMs, reviewDecision: 'remove', updatedAt: FieldValue.serverTimestamp() });
      return { status: 200, body: { ok: true, result: 'removed' }, photoOnly: t };
    }
    if (t.status === 'removed') return { status: 409, body: { error: 'This tip was removed.' } };
    tx.update(ref, { status: 'live', hidden: false, reportCount: 0, heldReasons: [], reviewedAt: nowMs, reviewDecision: 'approve', updatedAt: FieldValue.serverTimestamp() });
    return { status: 200, body: { ok: true, result: 'live' }, resolve: true };
  });
  // After the decision, side by side so one failure doesn't strand another
  // (the photo above all); reports stay as the record.
  const steps = [];
  if (out.cleanup) {
    steps.push(
      Promise.all([db.collection('tip_reactions').where('tipId', '==', tipId).get(), db.collection('tip_views').where('tipId', '==', tipId).get()]).then(([r, v]) =>
        deleteRefs(db, [...r.docs, ...v.docs].map((d) => d.ref))
      ),
      deleteTipPhoto(out.cleanup.photoPath)
    );
  }
  if (out.photoOnly) steps.push(deleteTipPhoto(out.photoOnly.photoPath));
  if (out.resolve) {
    steps.push(
      db.collection('tip_reports').where('tipId', '==', tipId).get().then(async (reports) => {
        const open = reports.docs.filter((d) => !d.data().resolvedAt);
        for (let i = 0; i < open.length; i += 400) {
          const b = db.batch();
          for (const d of open.slice(i, i + 400)) b.update(d.ref, { resolvedAt: nowMs });
          await b.commit();
        }
      })
    );
  }
  const failed = (await Promise.allSettled(steps)).filter((x) => x.status === 'rejected');
  if (failed.length) console.error('tip moderation cleanup failed', failed.map((f) => f.reason?.message || f.reason));
  return { status: out.status, body: out.body };
}

// Nightly: marks and views left by a tip that is gone, or by an earlier post
// at the same id (a cleanup that failed after a delete). They never count,
// but they stay as data about a person; this removes them. Reports stay
// (the moderation record). It reads the tips itself, at sweep time, and
// skips anything from the last hour, so a tip posted while the job runs is
// never mistaken for a gone one. It walks each collection `max` docs a
// night from where it stopped (tip_sweep_state/cursor, server-only), so a
// big collection is covered over several nights.
export async function sweepTipOrphans(db, { max = 2000, nowMs = Date.now() } = {}) {
  const tipsSnap = await db.collection('tips').get();
  const genOf = new Map(tipsSnap.docs.map((d) => [d.id, d.data().gen ?? null]));
  const stateRef = db.collection('tip_sweep_state').doc('cursor');
  const state = (await stateRef.get()).data() || {};
  const next = {};
  let removed = 0;
  for (const col of ['tip_reactions', 'tip_views']) {
    let q = db.collection(col).orderBy(FieldPath.documentId()).limit(max);
    if (state[col]) q = q.startAfter(state[col]);
    const snap = await q.get();
    const stale = snap.docs.filter((d) => {
      const x = d.data() || {};
      const at = x.lastAt ?? x.firstAt ?? x.helpfulAt ?? x.savedAt ?? 0;
      if (nowMs - at < 60 * 60 * 1000) return false;
      return !genOf.has(x.tipId) || (x.gen ?? null) !== genOf.get(x.tipId);
    });
    await deleteRefs(db, stale.map((d) => d.ref));
    removed += stale.length;
    // A short page means the end: start over next night.
    next[col] = snap.docs.length < max ? null : snap.docs[snap.docs.length - 1].id;
  }
  await stateRef.set(next);
  return removed;
}
