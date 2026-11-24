import { verifyIdToken } from './_lib/verifyAuth.js';
import { withCors } from './_lib/cors.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { sendPushToUser } from './_lib/push.js';
import { FieldValue } from 'firebase-admin/firestore';
import { isAdmin } from '../src/lib/admins.js';

// The admin panel's "Send myself a test notification" (owner, 2026-11-23):
// a push to the admin's own devices only (the signed-in account's own
// tokens), plus the same line in their in-app notifications. Verified
// admin email only. Answers how many devices it reached, or why none.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (!account.emailVerified || !isAdmin(account.email)) {
    res.status(403).json({ error: 'Admin only.' });
    return;
  }
  // Admin Mode off: the admin is a normal user, and nothing in the panel works.
  const settings = await adminDb().collection('admin_settings').doc(account.uid).get().catch(() => null);
  if (!settings?.exists || settings.data()?.adminMode !== true) {
    res.status(403).json({ error: 'Turn on Admin Mode first.' });
    return;
  }
  if (isRateLimited(req, 'admin-test-push', { limit: 10, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many test notifications in a row. Wait a bit.' });
    return;
  }
  const title = 'Test notification';
  const body = 'Push notifications are working on this device.';
  const out = await sendPushToUser(account.uid, { title, body, data: { type: 'admin-test' } });
  await adminDb()
    .collection('notifications')
    .add({ uid: account.uid, type: 'admin_test', message: `\u{1F514} ${body}`, read: false, createdAt: FieldValue.serverTimestamp() })
    .catch(() => {});
  res.status(200).json({ ok: true, sent: out?.sent || 0, reason: out?.reason || null });
}

export default withCors(handler);
