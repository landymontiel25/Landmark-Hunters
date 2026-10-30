import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { quotaDay } from './photoBackfill.js';

// Daily usage caps shared by every serverless instance, on top of the
// in-memory burst limiter in rateLimit.js (which each warm instance keeps
// on its own). Two layers, both counted per Pacific-time day so they line
// up with Google's own quota reset:
//
//   - per caller: usage_quota/{day}_{scope}_{uid or ip}, a transaction so
//     the count is exact. One account (or one signed-out IP) can't run up
//     more than `limit` billed calls a day, however many instances serve it.
//   - global: usage_quota/{day}_{scope}_all, a circuit breaker across every
//     caller. It catches abuse spread over many accounts. Each instance
//     re-reads it at most every GLOBAL_REFRESH_MS and bumps it with a plain
//     increment (no transaction, so a flood doesn't fight over one doc);
//     the cap can overshoot by a few calls per instance, never by thousands.
//
// Server-only collection: firestore.rules has no match for it, so clients
// can't read or write it. Each doc carries expireAt for a Firestore TTL
// policy (owner step in docs/rate-limits.md).
//
// Fails open: with no FIREBASE_SERVICE_ACCOUNT, or Firestore slow or down,
// the request goes through (the burst limiter still applies) and a
// `usage_quota_error` line goes to the function log.

export const QUOTA_COLLECTION = 'usage_quota';
const FIRESTORE_TIMEOUT_MS = 1500;
const GLOBAL_REFRESH_MS = 10 * 1000;
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

// Daily caps. `user` is per signed-in account, `anon` per signed-out IP
// (only the Google endpoints allow signed-out use), `global` across
// everyone. Each env var overrides its global cap without a deploy.
export const DAILY_QUOTAS = {
  'ai-plan': { user: 150, global: 20000, env: 'AI_DAILY_GLOBAL_CAP' },
  'ai-search': { user: 400, global: 40000, env: 'AI_SEARCH_DAILY_GLOBAL_CAP' },
  'ai-picks': { user: 200, global: 20000, env: 'AI_PICKS_DAILY_GLOBAL_CAP' },
  'ai-classify': { user: 100, global: 10000, env: 'AI_CLASSIFY_DAILY_GLOBAL_CAP' },
  'ai-verify': { user: 60, global: 5000, env: 'AI_VERIFY_DAILY_GLOBAL_CAP' },
  'ai-ratings': { user: 1500, global: 60000, env: 'AI_RATINGS_DAILY_GLOBAL_CAP' },
  'google-autocomplete': { user: 600, anon: 150, global: 20000, env: 'GOOGLE_AUTOCOMPLETE_DAILY_GLOBAL_CAP' },
  'google-details': { user: 300, anon: 60, global: 10000, env: 'GOOGLE_DETAILS_DAILY_GLOBAL_CAP' },
  'google-nearby': { user: 150, anon: 30, global: 5000, env: 'GOOGLE_NEARBY_DAILY_GLOBAL_CAP' },
  'google-directions': { user: 200, anon: 40, global: 8000, env: 'GOOGLE_DIRECTIONS_DAILY_GLOBAL_CAP' },
};

export function globalCap(scope, env = process.env) {
  const q = DAILY_QUOTAS[scope];
  const fromEnv = Number(env[q.env]);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : q.global;
}

const globalCache = new Map();

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('usage quota timeout')), FIRESTORE_TIMEOUT_MS)),
  ]);
}

const safeId = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);

async function takeCaller(db, scope, caller, limit, now) {
  const ref = db.collection(QUOTA_COLLECTION).doc(`${quotaDay(now)}_${scope}_${safeId(caller)}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.exists ? snap.data()?.count : 0) || 0;
    if (count >= limit) return false;
    tx.set(ref, { scope, count: count + 1, expireAt: new Date(now + KEEP_MS) }, { merge: true });
    return true;
  });
}

async function takeGlobal(db, scope, cap, now) {
  const day = quotaDay(now);
  const ref = db.collection(QUOTA_COLLECTION).doc(`${day}_${scope}_all`);
  const key = `${day}_${scope}`;
  let cached = globalCache.get(key);
  if (!cached || now - cached.readAt > GLOBAL_REFRESH_MS) {
    const snap = await ref.get();
    cached = { count: Number(snap.exists ? snap.data()?.count : 0) || 0, readAt: now, local: 0 };
    globalCache.set(key, cached);
    // Yesterday's entries are dead weight in a warm instance.
    for (const k of globalCache.keys()) if (!k.startsWith(day)) globalCache.delete(k);
  }
  if (cached.count + cached.local >= cap) return false;
  cached.local += 1;
  await ref.set({ scope, count: FieldValue.increment(1), expireAt: new Date(now + KEEP_MS) }, { merge: true });
  return true;
}

/**
 * Counts one billed call against today's caps. `uid` for a signed-in
 * caller, `ip` otherwise. Returns { ok: true } or
 * { ok: false, reason: 'user' | 'global' }; never throws.
 */
export async function takeDailyQuota(scope, { uid, ip, db = null, now = Date.now(), env = process.env } = {}) {
  const q = DAILY_QUOTAS[scope];
  if (!q) throw new Error(`Unknown quota scope: ${scope}`);
  const limit = uid ? q.user : q.anon;
  if (!limit) return { ok: false, reason: 'user' };
  try {
    const store = db || adminDb();
    const caller = uid ? `uid-${uid}` : `ip-${ip || 'unknown'}`;
    if (!(await withTimeout(takeCaller(store, scope, caller, limit, now)))) return { ok: false, reason: 'user' };
    if (!(await withTimeout(takeGlobal(store, scope, globalCap(scope, env), now)))) {
      console.warn(JSON.stringify({ type: 'usage_quota_global_cap', scope }));
      return { ok: false, reason: 'global' };
    }
    return { ok: true };
  } catch (e) {
    try {
      console.warn(JSON.stringify({ type: 'usage_quota_error', scope, error: String(e?.message || e).slice(0, 200) }));
    } catch {
      /* logging must never break a reply */
    }
    return { ok: true };
  }
}

export function quotaMessage(reason, what) {
  return reason === 'global'
    ? `${what} is paused for everyone for the rest of today. Try again tomorrow.`
    : `You've hit today's limit for ${what.toLowerCase()}. It resets at midnight Pacific time.`;
}

export function resetGlobalCacheForTests() {
  globalCache.clear();
}
