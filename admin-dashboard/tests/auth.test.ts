import { describe, it, expect, beforeEach } from 'vitest';
import { _resetLoginLimits, LOGIN_LIMIT, loginLimited, passwordMatches, signSession, verifySession } from '@/lib/auth';

const SECRET = 'x'.repeat(40);

describe('session tokens', () => {
  it('round-trips a signed session', async () => {
    const t = await signSession(SECRET);
    expect(await verifySession(t, SECRET)).toBe(true);
  });
  it('rejects a token signed with another secret, tampered, or missing', async () => {
    const t = await signSession(SECRET);
    expect(await verifySession(t, 'y'.repeat(40))).toBe(false);
    expect(await verifySession(t.slice(0, -2) + 'aa', SECRET)).toBe(false);
    expect(await verifySession(undefined, SECRET)).toBe(false);
    expect(await verifySession('not.a.jwt', SECRET)).toBe(false);
  });
  it('refuses to sign with a short or missing secret', async () => {
    await expect(signSession('short')).rejects.toThrow(/JWT_SECRET/);
  });
});

describe('password check', () => {
  const expected = 'a1b2c3d4e5f6a7b8c9d0';
  it('matches only the exact password', () => {
    expect(passwordMatches(expected, expected)).toBe(true);
    expect(passwordMatches(expected + 'x', expected)).toBe(false);
    expect(passwordMatches(expected.slice(0, -1), expected)).toBe(false);
    expect(passwordMatches('', expected)).toBe(false);
    expect(passwordMatches(42, expected)).toBe(false);
  });
  it('never matches when the server password is unset or too short', () => {
    expect(passwordMatches('', '')).toBe(false);
    expect(passwordMatches('short', 'short')).toBe(false);
  });
});

describe('login rate limit', () => {
  beforeEach(() => _resetLoginLimits());
  it(`allows ${LOGIN_LIMIT} tries per IP per window, then blocks`, () => {
    for (let i = 0; i < LOGIN_LIMIT; i++) expect(loginLimited('1.2.3.4', 1000)).toBe(false);
    expect(loginLimited('1.2.3.4', 1000)).toBe(true);
    expect(loginLimited('5.6.7.8', 1000)).toBe(false);
    expect(loginLimited('1.2.3.4', 1000 + 16 * 60 * 1000)).toBe(false);
  });
});
