import { FieldValue } from 'firebase-admin/firestore';
import { toMs } from './time.js';
import { deleteRefs, deleteTipPhoto } from './tipsServer.js';

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
  const [held, reported, withdrawn] = await Promise.all([
    db.collection('tips').where('status', '==', 'held').limit(QUEUE_LIMIT).get(),
    db.collection('tips').where('reportCount', '>', 0).limit(QUEUE_LIMIT).get(),
    db.collection('tips').where('status', '==', 'withdrawn').limit(QUEUE_LIMIT).get(),
  ]);
  const byId = new Map();
  for (const d of [...held.docs, ...reported.docs, ...withdrawn.docs]) {
    const t = d.data();
    if (t.status === 'removed') continue;
    byId.set(d.id, t);
  }
  const ids = [...byId.keys()];
  const reportSnaps = await Promise.all(ids.map((id) => db.collection('tip_reports').where('tipId', '==', id).get()));
  const rows = ids.map((id, i) => {
    const t = byId.get(id);
    const reports = reportSnaps[i].docs.map((d) => d.data()).filter((r) => (r.gen ?? null) === (t.gen ?? null) && !r.resolvedAt);
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
export async function moderateTip(db, tipId, decision, { nowMs = Date.now() } = {}) {
  if (typeof tipId !== 'string' || !/^[\w.-]{1,300}$/.test(tipId)) return { status: 400, body: { error: 'tipId is required.' } };
  if (!TIP_DECISIONS.includes(decision)) return { status: 400, body: { error: 'Unknown decision.' } };
  const ref = db.collection('tips').doc(tipId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: 'No such tip.' } };
  const t = snap.data();
  const gone = decision === 'clear' || (decision === 'approve' && t.status === 'withdrawn');
  if (gone) {
    await ref.delete();
    const [reactions, views] = await Promise.all([
      db.collection('tip_reactions').where('tipId', '==', tipId).get(),
      db.collection('tip_views').where('tipId', '==', tipId).get(),
    ]);
    await deleteRefs(db, [...reactions.docs, ...views.docs].map((d) => d.ref));
    await deleteTipPhoto(t.photoPath);
    return { status: 200, body: { ok: true, result: 'deleted' } };
  }
  if (decision === 'remove') {
    await ref.update({ status: 'removed', hidden: true, photoURL: null, reviewedAt: nowMs, reviewDecision: 'remove', updatedAt: FieldValue.serverTimestamp() });
    await deleteTipPhoto(t.photoPath);
    return { status: 200, body: { ok: true, result: 'removed' } };
  }
  // approve
  if (t.status === 'removed') return { status: 409, body: { error: 'This tip was removed.' } };
  await ref.update({ status: 'live', hidden: false, reportCount: 0, heldReasons: [], reviewedAt: nowMs, reviewDecision: 'approve', updatedAt: FieldValue.serverTimestamp() });
  const reports = await db.collection('tip_reports').where('tipId', '==', tipId).get();
  const open = reports.docs.filter((d) => !d.data().resolvedAt);
  for (let i = 0; i < open.length; i += 400) {
    const b = db.batch();
    for (const d of open.slice(i, i + 400)) b.update(d.ref, { resolvedAt: nowMs });
    await b.commit();
  }
  return { status: 200, body: { ok: true, result: 'live' } };
}

// Nightly: marks and views left by a tip that is gone, or by an earlier post
// at the same id (a cleanup that failed after a delete). They never count,
// but they stay as data about a person; this removes them. Reports stay
// (the moderation record). At most `max` of each per night.
// Never runs on a partial list of tips (a truncated read would make live
// tips look gone).
export async function sweepTipOrphans(db, tips, { max = 2000, truncated = [] } = {}) {
  if (!Array.isArray(tips) || truncated.includes('tips')) return 0;
  const genOf = new Map((tips || []).map((t) => [t.id, t.gen ?? null]));
  const stale = (d) => {
    const x = d.data() || {};
    return !genOf.has(x.tipId) || (x.gen ?? null) !== genOf.get(x.tipId);
  };
  const [reactions, views] = await Promise.all([db.collection('tip_reactions').limit(max).get(), db.collection('tip_views').limit(max).get()]);
  const refs = [...reactions.docs, ...views.docs].filter(stale).map((d) => d.ref);
  await deleteRefs(db, refs);
  return refs.length;
}
