import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import { blockedBetween, blockedEitherWay, HOUR_MS, ID_RE, madeOnThisPost, send, tipForViewer } from './_lib/tipsServer.js';
import { canonicalLandmarkId, canonicalRegionId } from '../src/data/regions.js';
import { tipIsPublic, TIP_REPORT_HIDE } from '../src/lib/tips.js';

// Reading tips and reacting to them (docs/discovery-network-plan.md,
// Phase 1). Tips of other people are read here, not straight from
// Firestore, because only the server can hide tips across a block in both
// directions (a client can't see who blocked it).
//   GET  ?region=&landmarkId=              your own tip there (any status)
//                                          first, then live tips, newest
//                                          first, plus your helpful/saved marks
//   POST { action: 'react', tipId, kind: 'helpful' | 'saved', on }
//   POST { action: 'report', tipId, reason }
// Each GET records which tips you were shown (tip_views, server-only) for
// the "went because of a tip" count later. Nobody ever sees who viewed,
// marked or reported a tip: counts only. Every mark, report and view
// carries the tip's `gen` (see api/_lib/tipsServer.js).

const MAX_TIPS = 50;
// A view's lastAt moves at most this often, so a reload writes nothing.
const VIEW_REFRESH_MS = 12 * 60 * 60 * 1000;
export const REPORT_REASONS = ['spam', 'offensive', 'false', 'private-info', 'other'];

export async function listTips(db, viewerUid, { region, landmarkId }, { nowMs = Date.now() } = {}) {
  // The place's live tips (two equality filters, no composite index), plus
  // your own tip by its id whatever its status, so the page can say it is
  // waiting for review or was removed. Sorted here, newest first.
  const id = canonicalLandmarkId(landmarkId, region);
  const ownId = `${viewerUid}_${id}`;
  const [snap, ownSnap, blocked] = await Promise.all([
    db.collection('tips').where('landmarkId', '==', id).where('status', '==', 'live').get(),
    db.collection('tips').doc(ownId).get(),
    blockedBetween(db, viewerUid),
  ]);
  const want = canonicalRegionId(region);
  const visible = [];
  for (const d of snap.docs) {
    const t = d.data();
    if (d.id === ownId || canonicalRegionId(t.region) !== want) continue;
    if (!tipIsPublic(t) || blocked.has(t.authorUid)) continue;
    visible.push([d.id, t]);
  }
  const at = (t) => toMs(t.createdAt) ?? t.createdAtMs ?? 0;
  visible.sort((a, b) => at(b[1]) - at(a[1]));
  const own = ownSnap.exists && canonicalRegionId(ownSnap.data().region) === want ? [[ownId, ownSnap.data()]] : [];
  const shown = [...own, ...visible.slice(0, MAX_TIPS)];

  // Everyone else's tips here are live and public (the own tip is first).
  const others = shown.slice(own.length);
  const reactionRefs = others.map(([tipId]) => db.collection('tip_reactions').doc(`${viewerUid}_${tipId}`));
  const viewRefs = others.map(([tipId]) => db.collection('tip_views').doc(`${viewerUid}_${tipId}`));
  const [reactionSnaps, viewSnaps] = await Promise.all([
    reactionRefs.length ? db.getAll(...reactionRefs) : [],
    viewRefs.length ? db.getAll(...viewRefs) : [],
  ]);
  const mine = {};
  reactionSnaps.forEach((s, i) => {
    if (s.exists && madeOnThisPost(s.data(), others[i][1])) mine[others[i][0]] = { helpful: s.data().helpful === true, saved: s.data().saved === true };
  });

  // Views: other people's live tips only. firstAt (when you first saw this
  // post of the tip) never moves.
  const batch = db.batch();
  let writes = 0;
  others.forEach(([tipId, t], i) => {
    const prev = viewSnaps[i].exists && madeOnThisPost(viewSnaps[i].data(), t) ? viewSnaps[i].data() : null;
    if (prev && nowMs - (prev.lastAt || 0) < VIEW_REFRESH_MS) return;
    writes++;
    batch.set(viewRefs[i], {
      uid: viewerUid,
      tipId,
      gen: t.gen ?? null,
      authorUid: t.authorUid,
      landmarkId: t.landmarkId,
      region: t.region || null,
      firstAt: prev?.firstAt ?? nowMs,
      lastAt: nowMs,
    });
  });
  if (writes) await batch.commit();

  return {
    tips: shown.map(([tipId, t]) => ({ ...tipForViewer(tipId, t, viewerUid), ...(t.authorUid === viewerUid ? { status: t.status, hidden: t.hidden === true } : {}) })),
    reactions: mine,
  };
}

// The tip, if this viewer may act on it: someone else's, live, unhidden,
// no block either way.
async function actionableTip(db, uid, tipId) {
  const ref = db.collection('tips').doc(tipId);
  const snap = await ref.get();
  if (!snap.exists) return { error: [404, { error: 'No such tip.' }] };
  const tip = snap.data();
  if (tip.authorUid === uid) return { error: [400, { error: 'That is your own tip.' }] };
  if (!tipIsPublic(tip)) return { error: [404, { error: 'No such tip.' }] };
  if (await blockedEitherWay(db, uid, tip.authorUid)) return { error: [404, { error: 'No such tip.' }] };
  return { ref, tip };
}

export async function reactToTip(db, uid, { tipId, kind, on }) {
  if (!['helpful', 'saved'].includes(kind) || typeof on !== 'boolean') return [400, { error: 'kind and on are required.' }];
  // Adding a mark needs a tip you can see; taking one back works on any
  // tip you marked, even one hidden or blocked since.
  let tipRef = db.collection('tips').doc(tipId);
  let seenGen = null;
  if (on) {
    const found = await actionableTip(db, uid, tipId);
    if (found.error) return found.error;
    tipRef = found.ref;
    seenGen = found.tip.gen ?? null;
  }
  const reactionRef = db.collection('tip_reactions').doc(`${uid}_${tipId}`);
  const out = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(tipRef), tx.get(reactionRef)]);
    const tip = tipSnap.exists ? tipSnap.data() : null;
    // Still the post you saw, and still public.
    if (on && (!tip || !tipIsPublic(tip) || (tip.gen ?? null) !== seenGen)) return null;
    // A mark from an older post at the same id counts as no mark.
    const prev = rSnap.exists && madeOnThisPost(rSnap.data(), tip) ? rSnap.data() : { helpful: false, saved: false };
    const next = { helpful: prev.helpful === true, saved: prev.saved === true, [kind]: on };
    if (tip && (prev[kind] === true) !== on) tx.update(tipRef, { [`counts.${kind}`]: FieldValue.increment(on ? 1 : -1) });
    if (!next.helpful && !next.saved) {
      if (rSnap.exists) tx.delete(reactionRef);
    } else {
      tx.set(reactionRef, {
        uid,
        tipId,
        gen: tip.gen ?? null,
        authorUid: tip.authorUid,
        landmarkId: tip.landmarkId,
        region: tip.region || null,
        helpful: next.helpful,
        saved: next.saved,
        firstAt: prev.firstAt ?? Date.now(),
        ...(on ? { [`${kind}At`]: Date.now() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return next;
  });
  if (!out) return [404, { error: 'No such tip.' }];
  return [200, { ok: true, reaction: out }];
}

// Two distinct reporters hide a tip until the owner reviews it. Who
// reported stays in server-only tip_reports/{tipId}_{gen}_{uid} (no rule matches
// it, so clients are denied), never on the tip, which its author can read.
export async function reportTip(db, uid, { tipId, reason }) {
  if (!REPORT_REASONS.includes(reason)) return [400, { error: 'Pick a reason.' }];
  const found = await actionableTip(db, uid, tipId);
  if (found.error) return found.error;
  // One doc per person per post of the tip, so a report on a later post
  // never overwrites the record of an earlier one.
  const reportRef = db.collection('tip_reports').doc(`${tipId}_${found.tip.gen ?? 'nogen'}_${uid}`);
  const ok = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(found.ref), tx.get(reportRef)]);
    const tip = tipSnap.exists ? tipSnap.data() : null;
    // Still the post you saw, and still public.
    if (!tip || !tipIsPublic(tip) || (tip.gen ?? null) !== (found.tip.gen ?? null)) return false;
    // One report per person per post.
    if (rSnap.exists && madeOnThisPost(rSnap.data(), tip)) return true;
    const next = (tip.reportCount || 0) + 1;
    tx.set(reportRef, { uid, tipId, gen: tip.gen ?? null, authorUid: tip.authorUid, reason, at: Date.now() });
    tx.update(found.ref, { reportCount: next, hidden: next >= TIP_REPORT_HIDE, lastReportedAt: Date.now() });
    return true;
  });
  if (!ok) return [404, { error: 'No such tip.' }];
  return [200, { ok: true }];
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  try {
    const db = adminDb();
    if (req.method === 'GET') {
      if (isRateLimited(req, 'tips-read', { limit: 600, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
      const region = String(req.query?.region || '');
      const landmarkId = String(req.query?.landmarkId || '');
      if (!ID_RE.test(region) || !ID_RE.test(landmarkId)) return send(res, 400, { error: 'region and landmarkId are required.' });
      res.setHeader?.('Cache-Control', 'private, no-store');
      return send(res, 200, await listTips(db, account.uid, { region, landmarkId }));
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
    if (typeof body.tipId !== 'string' || !ID_RE.test(body.tipId)) return send(res, 400, { error: 'tipId is required.' });
    // Marks and reports move counts and hide tips, so they take a verified
    // email, like posting: a throwaway account can't hide a tip.
    if (!account.emailVerified) return send(res, 403, { error: 'Verify your email first.', code: 'email' });
    if (body.action === 'react') {
      if (isRateLimited(req, 'tips-react', { limit: 200, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
      const [code, out] = await reactToTip(db, account.uid, body);
      return send(res, code, out);
    }
    if (body.action === 'report') {
      if (isRateLimited(req, 'tips-report', { limit: 30, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many reports. Try again later.' });
      const [code, out] = await reportTip(db, account.uid, body);
      return send(res, code, out);
    }
    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error('tips failed', err?.message || err);
    return send(res, 500, { error: 'Could not load tips. Try again.' });
  }
}

export default withCors(handler);
