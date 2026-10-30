import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { appCheckGate } from './appCheck.js';
import { quotaMessage, takeDailyQuota } from './usageQuota.js';

// Which daily quota (usageQuota.js DAILY_QUOTAS) each AI route counts against.
export const AI_QUOTA_SCOPES = {
  'plan-ai': 'ai-plan',
  'smart-search': 'ai-search',
  'pick-reasons': 'ai-picks',
  'classify-interest': 'ai-classify',
  'verify-landmark': 'ai-verify',
  'landmark-ratings': 'ai-ratings',
};

/**
 * Shared gate for every endpoint that spends money on the Anthropic API:
 * App Check (per APP_CHECK_MODE), a verified Firebase sign-in, a
 * short-window per-account rate limit, and a daily per-account cap plus a
 * daily cap across all accounts (usageQuota.js). Sends the error response
 * itself and returns null when the request should stop; otherwise returns
 * the account.
 */
export async function guardAiRequest(req, res, { key, limit, windowMs, account: known, quota = takeDailyQuota }) {
  if (!(await appCheckGate(req, res, key))) return null;
  const account = known || (await verifyIdToken(req));
  if (!account) {
    res.status(401).json({ code: 'sign-in-required', error: 'Sign in to use the AI features.' });
    return null;
  }
  if (isRateLimited(req, key, { limit, windowMs, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests in a row — take a short break and try again.' });
    return null;
  }
  const scope = AI_QUOTA_SCOPES[key];
  if (scope) {
    const taken = await quota(scope, { uid: account.uid });
    if (!taken.ok) {
      res.status(429).json({ code: 'daily-limit', error: quotaMessage(taken.reason, 'Mapr') });
      return null;
    }
  }
  return account;
}
