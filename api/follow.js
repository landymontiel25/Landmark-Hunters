import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { isFirestoreId, send } from './_lib/tipsServer.js';
import { deleteMyFollows, follow, removeFollowsBetween, unfollow } from './_lib/follows.js';

// Follows (docs/discovery-network-plan.md, Phase 2). The only way a follow
// is made or removed: the rules refuse every client write to follows/ and
// to the counts on users/.
//   POST { action: 'follow', uid }        follow a public profile
//   POST { action: 'unfollow', uid }
//   POST { action: 'blocked', uid }       after a block either way: the
//                                         follows between you go, both ways
//   POST { action: 'delete-mine' }        account deletion
// Following needs a verified email, so made-up accounts can't pile on
// followers.

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'follow', { limit: 120, windowMs: 60 * 60 * 1000, id: account.uid })) {
    return send(res, 429, { error: 'Too many requests. Try again later.' });
  }
  const { action, uid } = req.body || {};
  try {
    const db = adminDb();
    if (action === 'delete-mine') {
      const removed = await deleteMyFollows(db, account.uid);
      return send(res, 200, { ok: true, removed });
    }
    if (!isFirestoreId(uid)) return send(res, 400, { error: 'uid is required.' });
    if (action === 'follow') {
      if (!account.emailVerified) return send(res, 403, { error: 'Verify your email to follow people.', code: 'unverified' });
      const [code, body] = await follow(db, account.uid, uid);
      return send(res, code, body);
    }
    if (action === 'unfollow') {
      const [code, body] = await unfollow(db, account.uid, uid);
      return send(res, code, body);
    }
    if (action === 'blocked') {
      // Only once a block between the two exists, so nobody can unfollow
      // someone else's follows.
      const [x, y] = await Promise.all([db.collection('blocks').doc(`${account.uid}_${uid}`).get(), db.collection('blocks').doc(`${uid}_${account.uid}`).get()]);
      if (!x.exists && !y.exists) return send(res, 400, { error: 'No block between you.' });
      await removeFollowsBetween(db, account.uid, uid);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('follow failed', e?.message || e);
    return send(res, 500, { error: 'Could not update follows. Try again.' });
  }
}

export default withCors(handler);
