import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { blockedEitherWay, isFirestoreId, send } from './_lib/tipsServer.js';

// What a friend's full profile page (src/screens/FriendProfile.jsx) cannot
// read for itself, and the one write the rules refuse a phone.
//   POST { action: 'solo-streak', uid }   the friend's solo streak: only
//                                         count, lastCompletedDay and
//                                         frozenDays (the phone works out
//                                         whether it is still live on its own
//                                         calendar day). Nothing else on the
//                                         streak doc (city, freezes) is sent.
//                                         Friends only, no block either way,
//                                         and never for a private profile.
//   POST { action: 'unfriend', uid }      removes BOTH friend_edges. The rules
//                                         let a phone delete only its own
//                                         half, which would leave the other
//                                         person still able to read friends-
//                                         only content.

const edgeId = (a, b) => `${a}_${b}`;

export async function soloStreakOf(db, viewerUid, uid) {
  if (viewerUid === uid) return [400, { error: 'That is you.' }];
  const [edge, target] = await Promise.all([db.collection('friend_edges').doc(edgeId(viewerUid, uid)).get(), db.collection('users').doc(uid).get()]);
  // A block, a missing account and a non-friend all read the same.
  if (!edge.exists || !target.exists || (await blockedEitherWay(db, viewerUid, uid))) return [404, { error: 'That profile is not available.', code: 'unavailable' }];
  if (target.data()?.public !== true) return [200, { soloStreak: null, private: true }];
  const snap = await db.collection('streaks').doc(uid).get();
  const s = snap.exists ? snap.data() : null;
  if (!s || s.mode !== 'solo') return [200, { soloStreak: null }];
  return [200, { soloStreak: { count: Number(s.count) || 0, lastCompletedDay: s.lastCompletedDay || null, frozenDays: Array.isArray(s.frozenDays) ? s.frozenDays.slice(-4) : [] } }];
}

export async function unfriend(db, viewerUid, uid) {
  if (viewerUid === uid) return [400, { error: 'That is you.' }];
  const mine = db.collection('friend_edges').doc(edgeId(viewerUid, uid));
  const theirs = db.collection('friend_edges').doc(edgeId(uid, viewerUid));
  const batch = db.batch();
  batch.delete(mine);
  batch.delete(theirs);
  await batch.commit();
  return [200, { ok: true }];
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'friend-profile', { limit: 240, windowMs: 60 * 60 * 1000, id: account.uid })) {
    return send(res, 429, { error: 'Too many requests. Try again later.' });
  }
  const { action, uid } = req.body || {};
  if (!isFirestoreId(uid)) return send(res, 400, { error: 'uid is required.' });
  try {
    const db = adminDb();
    if (action === 'solo-streak') {
      const [code, body] = await soloStreakOf(db, account.uid, uid);
      return send(res, code, body);
    }
    if (action === 'unfriend') {
      const [code, body] = await unfriend(db, account.uid, uid);
      return send(res, code, body);
    }
    return send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('friend-profile failed', e?.message || e);
    return send(res, 500, { error: 'Could not do that. Try again.' });
  }
}

export default withCors(handler);
