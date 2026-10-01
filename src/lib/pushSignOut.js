import { removePushToken } from './friends';
import { hasPushPermission, getPushToken, deletePushToken, removePushListeners } from './pushNotifications';

// Called just before signing out (needs the session still valid for the
// Firestore write). Without it, a shared phone keeps this device's FCM token
// on the old account and keeps showing that account's pushes. Best effort:
// never throws and never holds sign-out up for more than a few seconds.
export async function cleanUpPushOnSignOut(uid, { timeoutMs = 3000 } = {}) {
  if (!uid) return;
  const work = (async () => {
    try {
      if (!(await hasPushPermission())) return;
      const token = await getPushToken();
      if (token) await removePushToken(uid, token);
    } catch {
      /* ignore */
    }
    try {
      await removePushListeners();
      await deletePushToken();
    } catch {
      /* ignore */
    }
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
}
