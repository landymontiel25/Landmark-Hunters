import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './withTimeout';
import { authErrorMessage } from './authErrors';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('passes through a result that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('passes through the original error', async () => {
    const err = Object.assign(new Error('x'), { code: 'auth/invalid-credential' });
    await expect(withTimeout(Promise.reject(err), 50)).rejects.toBe(err);
  });

  it('rejects with auth/timeout when the promise never settles', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 15000);
    const assertion = expect(p).rejects.toMatchObject({ code: 'auth/timeout' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('has a plain-language message for the timeout', () => {
    expect(authErrorMessage({ code: 'auth/timeout' })).toMatch(/taking too long/);
  });
});
