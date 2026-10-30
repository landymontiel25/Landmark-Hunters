import { describe, it, expect, vi } from 'vitest';

vi.mock('./verifyAuth.js', () => ({ verifyIdToken: async (req) => (req.headers.authorization ? { uid: 'u1' } : null) }));
const { guardAiRequest } = await import('./aiGuard.js');

function fakeRes() {
  return { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const signedIn = { headers: { authorization: 'Bearer t' } };

describe('AI guard', () => {
  it('needs a sign-in', async () => {
    const res = fakeRes();
    expect(await guardAiRequest({ headers: {} }, res, { key: 'plan-ai', limit: 5, windowMs: 1000, quota: async () => ({ ok: true }) })).toBeNull();
    expect(res.code).toBe(401);
  });

  it('counts each call against the route daily quota for that account', async () => {
    const quota = vi.fn(async () => ({ ok: true }));
    expect(await guardAiRequest(signedIn, fakeRes(), { key: 'smart-search', limit: 5, windowMs: 1000, quota })).toEqual({ uid: 'u1' });
    expect(quota).toHaveBeenCalledWith('ai-search', { uid: 'u1' });
  });

  it('stops the account once the daily quota is used up', async () => {
    const res = fakeRes();
    expect(await guardAiRequest(signedIn, res, { key: 'pick-reasons', limit: 5, windowMs: 1000, quota: async () => ({ ok: false, reason: 'user' }) })).toBeNull();
    expect(res.code).toBe(429);
    expect(res.body).toMatchObject({ code: 'daily-limit' });
  });
});
