import { SignJWT, jwtVerify } from 'jose';

// Phase 1 auth: one owner password (ADMIN_SECRET_TOKEN) exchanged for a
// signed session (JWT_SECRET) kept in an httpOnly, Secure, SameSite=Strict
// cookie, so page scripts can never read it. proxy.ts checks the cookie on
// every dashboard page and API call.

export const SESSION_COOKIE = 'lh_admin_session';
export const SESSION_DAYS = 30;
const ISSUER = 'landmark-hunters-admin';

const key = (secret = process.env.JWT_SECRET) => {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.');
  return new TextEncoder().encode(secret);
};

export async function signSession(secret?: string): Promise<string> {
  return new SignJWT({ admin: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

export async function verifySession(token: string | undefined | null, secret?: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, algorithms: ['HS256'] });
    return payload.admin === true;
  } catch {
    return false;
  }
}

// Constant-time compare (no early exit on the first wrong character).
export function passwordMatches(given: unknown, expected = process.env.ADMIN_SECRET_TOKEN): boolean {
  if (typeof given !== 'string' || !expected || expected.length < 16) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// Login attempts per IP: LOGIN_LIMIT per LOGIN_WINDOW_MS (per server
// instance; enough to stop password guessing at any useful speed).
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, number[]>();
export function loginLimited(ip: string, now = Date.now()): boolean {
  const recent = (attempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > LOGIN_LIMIT;
}
export const _resetLoginLimits = () => attempts.clear();

export const cookieOptions = (maxAgeSeconds = SESSION_DAYS * 86400) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: maxAgeSeconds,
});
