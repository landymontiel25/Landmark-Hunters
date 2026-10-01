// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: (...a) => setDocMock(...a),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: () => 'DEL',
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('./firebase', () => ({ db: {} }));

const { markNewSignup } = await import('./onboardingSave');

beforeEach(() => setDocMock.mockClear());

describe('createdAt on a new account', () => {
  it('markNewSignup stamps createdAt (server time) with the sign-up mark, merged so nothing else is touched', async () => {
    await markNewSignup('u1');
    const [ref, data, opts] = setDocMock.mock.calls[0];
    expect(ref.path).toBe('users/u1');
    expect(data).toEqual({ onboardingSource: 'signup', createdAt: 'SERVER_TS' });
    expect(opts).toEqual({ merge: true });
  });
  it('does nothing without a uid', async () => {
    await markNewSignup(null);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
