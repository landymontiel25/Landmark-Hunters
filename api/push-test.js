import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { sendPushToUser } from './_lib/push.js';
import { withCors } from './_lib/cors.js';

// Settings' "Send test notification" button -- the only way to confirm the
// whole pipeline (device token saved, service account configured, APNs key
// uploaded to Firebase) actually works end to end, without waiting for a
// real dual-streak reminder to have something to send.
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
  if (isRateLimited(req, 'push-test', { limit: 5, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many test notifications -- wait a bit and try again.' });
    return;
  }
  const REASON_MESSAGE = {
    'not-configured': "Push isn't set up on the server yet (no service account configured).",
    'firestore-error': "Couldn't reach the database just now -- try again.",
    disabled: 'Push notifications are off for your account.',
    'no-devices': "This device isn't registered for push yet -- try toggling the setting off and back on.",
    'send-failed': "Couldn't reach Firebase Cloud Messaging just now -- try again.",
    'all-failed': "Sent, but every device rejected it -- the APNs key may not be uploaded to Firebase yet.",
  };
  try {
    const result = await sendPushToUser(account.uid, {
      title: 'Landmark Hunters',
      body: 'Push notifications are working.',
    });
    if (result.sent > 0) {
      res.status(200).json({ ok: true, sent: result.sent });
    } else {
      res.status(200).json({ ok: false, error: REASON_MESSAGE[result.reason] || 'Nothing was sent.' });
    }
  } catch (e) {
    console.error('[push-test]', e);
    res.status(500).json({ error: 'Could not send a test notification.' });
  }
}

export default withCors(handler);
