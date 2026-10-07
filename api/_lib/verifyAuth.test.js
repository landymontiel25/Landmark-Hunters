import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyIdToken } from './verifyAuth.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe('verifyIdToken', () => {
  it('passes a timeout signal and answers null when the lookup is aborted', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'k');
    let signal;
    globalThis.fetch = vi.fn((_url, opts) => {
      signal = opts.signal;
      return Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    });
    const out = await verifyIdToken({ headers: { authorization: 'Bearer t' } });
    expect(out).toBeNull();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the account on success', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'k');
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1', email: 'a@b.c', emailVerified: true }] }) }));
    expect(await verifyIdToken({ headers: { authorization: 'Bearer t' } })).toEqual({ uid: 'u1', email: 'a@b.c', emailVerified: true });
  });
});
