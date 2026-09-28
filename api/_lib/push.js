import { FieldValue } from 'firebase-admin/firestore';
import { adminMessaging, adminDb } from './firebaseAdmin.js';

const DEAD_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

// Sends to every device registered for this account (see savePushToken in
// friends.js), pruning any token FCM reports back as dead so a stale one
// (app uninstalled, old device) doesn't keep silently failing forever.
// Best-effort like every other notify path in this app: callers that just
// want to notify-if-possible (a future reminder/nudge) can ignore the
// return value entirely. Callers that need to know whether anything
// actually went out (api/push-test.js's "did this work?" button) get a
// {sent, reason} they can show to a person.
export async function sendPushToUser(uid, { title, body, data = {} }) {
  let db;
  try {
    db = adminDb();
  } catch {
    return { sent: 0, reason: 'not-configured' }; // FIREBASE_SERVICE_ACCOUNT not set
  }
  let snap;
  try {
    snap = await db.doc(`users/${uid}`).get();
  } catch {
    return { sent: 0, reason: 'firestore-error' };
  }
  const profile = snap.data() || {};
  if (!profile.pushNotificationsEnabled) return { sent: 0, reason: 'disabled' };
  const tokens = Object.keys(profile.pushTokens || {});
  if (!tokens.length) return { sent: 0, reason: 'no-devices' };

  let result;
  try {
    result = await adminMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    });
  } catch (e) {
    return { sent: 0, reason: 'send-failed', error: e?.message };
  }

  const dead = tokens.filter((_, i) => {
    const r = result.responses[i];
    return !r.success && DEAD_TOKEN_CODES.has(r.error?.code);
  });
  if (dead.length) {
    const update = {};
    for (const t of dead) update[`pushTokens.${t}`] = FieldValue.delete();
    await db.doc(`users/${uid}`).update(update).catch(() => {});
  }
  return { sent: result.successCount, reason: result.successCount ? 'ok' : 'all-failed' };
}
