import { describe, it, expect, vi, beforeEach } from 'vitest';
import { guardBilledRequest, resetSessionCacheForTests } from './billedGuard.js';

function fakeRes() {
  return { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const opts = (extra) => ({ scope: 'google-nearby', what: 'Place lookup', limit: 3, anonLimit: 1, windowMs: 60000, ...extra });

beforeEach(() => resetSessionCacheForTests());

describe('billed guard', () => {
  it('counts signed-out callers per IP with the tighter limit', async () => {
    const quota = vi.fn(async () => ({ ok: true }));
    const req = { headers: { 'x-forwarded-for': '9.9.9.1' } };
    expect(await guardBilledRequest(req, fakeRes(), opts({ key: 'bg-anon', quota }))).toBe(true);
    expect(quota).toHaveBeenCalledWith('google-nearby', { ip: '9.9.9.1' });
    const res = fakeRes();
    expect(await guardBilledRequest(req, res, opts({ key: 'bg-anon', quota }))).toBe(false);
    expect(res.code).toBe(429);
  });

  it('counts signed-in callers per account and caches the sign-in check', async () => {
    const quota = vi.fn(async () => ({ ok: true }));
    const verify = vi.fn(async () => ({ uid: 'u1' }));
    const req = { headers: { authorization: 'Bearer tok', 'x-forwarded-for': '9.9.9.2' } };
    for (let i = 0; i < 3; i++) expect(await guardBilledRequest(req, fakeRes(), opts({ key: 'bg-user', quota, verify }))).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(quota).toHaveBeenLastCalledWith('google-nearby', { uid: 'u1' });
    expect(await guardBilledRequest(req, fakeRes(), opts({ key: 'bg-user', quota, verify }))).toBe(false);
  });

  it('answers 429 with daily-limit once the day is used up', async () => {
    const res = fakeRes();
    const quota = async () => ({ ok: false, reason: 'global' });
    expect(await guardBilledRequest({ headers: {} }, res, opts({ key: 'bg-day', quota }))).toBe(false);
    expect(res.code).toBe(429);
    expect(res.body).toMatchObject({ code: 'daily-limit' });
    expect(res.body.error).toMatch(/paused for everyone/);
  });
});
