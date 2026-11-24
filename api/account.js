import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb, adminBucket } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { wipeAccountData } from './_lib/accountWipe.js';

// Account deletion, server side (owner, 2026-11-23, App Store rule
// 5.1.1(v)): POST { action: 'wipe' } removes everything the signed-in
// account owns (api/_lib/accountWipe.js), Mapr chats included. The app
// calls it from Delete Account right after asking for the password again,
// then deletes the sign-in itself. A sign-in older than 10 minutes is
// refused, so a token lifted from a device can't erase an account.
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

const send = (res, code, body) => res.status(code).json(body);

// auth_time (seconds) from a token Identity Toolkit has just accepted.
export function signInAgeMs(req, now = Date.now()) {
  try {
    const token = (req.headers.authorization || '').slice(7);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(claims.auth_time) ? now - claims.auth_time * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
  if (body.action !== 'wipe') return send(res, 400, { error: 'Unknown action.' });
  if (signInAgeMs(req) > RECENT_SIGN_IN_MS) {
    return send(res, 403, { error: 'Enter your password again, then delete your account.', code: 'recent-sign-in' });
  }
  if (isRateLimited(req, 'account-wipe', { limit: 5, windowMs: 60 * 60 * 1000, id: account.uid })) {
    return send(res, 429, { error: 'Too many requests. Try again later.' });
  }
  try {
    const out = await wipeAccountData(adminDb(), account.uid, { bucket: await adminBucket() });
    if (out.errors.length) console.error('[account] wipe: some steps failed', out.errors);
    return send(res, out.errors.length ? 500 : 200, { ok: !out.errors.length, failed: out.errors.length });
  } catch (e) {
    console.error('[account] wipe failed', e?.message || e);
    return send(res, 500, { error: "Couldn't delete your data. Try again." });
  }
}

export default withCors(handler);
