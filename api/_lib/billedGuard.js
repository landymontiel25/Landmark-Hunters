import { createHash } from 'node:crypto';
import { verifyIdToken } from './verifyAuth.js';
import { clientIp, isRateLimited } from './rateLimit.js';
import { appCheckGate } from './appCheck.js';
import { quotaMessage, takeDailyQuota } from './usageQuota.js';

// Gate for the Google-billed routes that also work signed out (address
// search, place details, place lookup, directions): App Check per
// APP_CHECK_MODE, a burst limit, and a daily cap (usageQuota.js). Signed in,
// both count per account; signed out, per IP and with lower limits, so a
// script without an account gets the least room.
//
// Verified sign-ins are cached for a few minutes by token hash, so typing
// in the address box doesn't add an Identity Toolkit round trip per letter.
const SESSION_CACHE_MS = 5 * 60 * 1000;
const sessions = new Map();

async function optionalAccount(req, verify) {
  const header = req.headers?.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const now = Date.now();
  const k = createHash('sha256').update(header).digest('base64url');
  const hit = sessions.get(k);
  if (hit && now - hit.at < SESSION_CACHE_MS) return hit.account;
  const account = await verify(req);
  if (sessions.size > 5000) for (const [key, e] of sessions) if (now - e.at > SESSION_CACHE_MS) sessions.delete(key);
  sessions.set(k, { account, at: now });
  return account;
}

/**
 * Returns false (after sending the response) when the request should stop.
 * `limit` is the per-account burst limit; signed-out callers get `anonLimit`.
 */
export async function guardBilledRequest(req, res, { key, scope, what, limit, anonLimit, windowMs, verify = verifyIdToken, quota = takeDailyQuota }) {
  if (!(await appCheckGate(req, res, key))) return false;
  const account = await optionalAccount(req, verify);
  const uid = account?.uid || null;
  if (isRateLimited(req, key, { limit: uid ? limit : anonLimit, windowMs, id: uid })) {
    res.status(429).json({ error: `Too many ${what.toLowerCase()} requests in a row — slow down a bit.` });
    return false;
  }
  const taken = await quota(scope, uid ? { uid } : { ip: clientIp(req) });
  if (!taken.ok) {
    res.status(429).json({ code: 'daily-limit', error: quotaMessage(taken.reason, what) });
    return false;
  }
  return true;
}

export function resetSessionCacheForTests() {
  sessions.clear();
}
