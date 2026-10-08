// Best-effort per-instance rate limiter for Vercel's serverless functions.
// Each warm lambda instance keeps its own in-memory counts, so this isn't a
// perfectly global limit across every concurrent instance -- but it blunts
// the realistic anonymous-abuse case (a script looping requests against a
// warm instance) for these billed AI endpoints, with zero new infra. A
// proper global limit would need a shared store (Vercel KV, Upstash, or a
// Firestore-backed counter via firebase-admin) -- worth adding if real
// abuse shows up in practice.
const buckets = new Map();
const MAX_KEYS = 5000;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Returns true if this request should be rejected as over the limit. Pass
 * `id` (a verified uid) to count per account instead of per IP, so one
 * person can't dodge it by switching networks and a shared IP (campus
 * wifi) doesn't lock out everyone behind it.
 */
export function isRateLimited(req, key, { limit, windowMs, id }) {
  const bucketKey = `${key}:${id ? `uid:${id}` : clientIp(req)}`;
  const now = Date.now();
  // Each new IP or uid adds a key; drop expired ones now and then so a warm
  // instance's memory doesn't grow for its whole life.
  if (buckets.size > MAX_KEYS) {
    for (const [k, e] of buckets) if (now - e.start > e.windowMs) buckets.delete(k);
  }
  const entry = buckets.get(bucketKey);
  if (!entry || now - entry.start > windowMs) {
    buckets.set(bucketKey, { start: now, count: 1, windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}
