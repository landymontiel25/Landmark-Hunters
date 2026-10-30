import { createPublicKey, createVerify } from 'node:crypto';

// Firebase App Check for our own /api/* routes: proof the request came from
// the real app (reCAPTCHA Enterprise on the web, an invisible CAPTCHA), not a
// script replaying requests. The client sends its token as
// X-Firebase-AppCheck (src/lib/apiAuth.js).
//
// Verified here by hand against Google's public keys, the same way
// verifyAuth.js avoids firebase-admin's Auth module (its key fetching
// crashes on Vercel's Node).
//
// APP_CHECK_MODE in Vercel:
//   off (default)  no check at all
//   monitor        check and log `app_check` lines, never block
//   enforce        a missing or bad token gets 401
// Stay on monitor until the iOS app sends tokens too (docs/rate-limits.md).

const JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
let jwksCache = null;

export function appCheckMode(env = process.env) {
  const m = String(env.APP_CHECK_MODE || '').trim().toLowerCase();
  return m === 'monitor' || m === 'enforce' ? m : 'off';
}

// The project number, which App Check puts in the token's issuer and
// audience. Firebase's messaging sender id is the same number.
export function projectNumber(env = process.env) {
  return String(env.FIREBASE_PROJECT_NUMBER || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
}

async function loadKeys(fetchImpl, now) {
  if (jwksCache && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const r = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const { keys } = await r.json();
  jwksCache = { keys: Array.isArray(keys) ? keys : [], at: now };
  return jwksCache.keys;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Returns the token's claims when it is a valid App Check token for this project, else null. */
export async function verifyAppCheckToken(token, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const project = projectNumber(env);
  if (!token || !project) return null;
  try {
    const [h, p, sig] = String(token).split('.');
    if (!h || !p || !sig) return null;
    const header = b64json(h);
    if (header.alg !== 'RS256' || header.typ !== 'JWT') return null;
    const jwk = (await loadKeys(fetchImpl, now)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const claims = b64json(p);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== `https://firebaseappcheck.googleapis.com/${project}`) return null;
    if (!aud.includes(`projects/${project}`)) return null;
    if (!(Number(claims.exp) * 1000 > now)) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Checks the request's App Check token per APP_CHECK_MODE. Sends the 401
 * itself and returns false only in enforce mode; true means carry on.
 */
export async function appCheckGate(req, res, key, opts = {}) {
  const mode = appCheckMode(opts.env);
  if (mode === 'off') return true;
  const token = req.headers?.['x-firebase-appcheck'];
  const claims = await verifyAppCheckToken(token, opts);
  if (claims) return true;
  try {
    console.warn(JSON.stringify({ type: 'app_check', key, mode, result: token ? 'invalid' : 'missing' }));
  } catch {
    /* logging must never break a reply */
  }
  if (mode !== 'enforce') return true;
  res.status(401).json({ code: 'app-check-failed', error: 'This request could not be verified. Update the app or reload the page and try again.' });
  return false;
}

export function resetAppCheckCacheForTests() {
  jwksCache = null;
}
