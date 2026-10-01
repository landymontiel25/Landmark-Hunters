// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: (...a) => setDocMock(...a),
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('./firebase', () => ({ db: {} }));

const { recordOpenDay, localDateKey } = await import('./openDays');

beforeEach(() => {
  setDocMock.mockReset();
  setDocMock.mockResolvedValue(undefined);
  localStorage.clear();
});

describe('daily open record', () => {
  it('uses the local day, zero padded', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 9, 1, 0, 1))).toBe('2026-10-01');
  });
  it('writes users/{uid}/open_days/{date} with only userId, date and server time', async () => {
    expect(await recordOpenDay('u1', new Date(2026, 9, 1, 9))).toBe(true);
    const [ref, data] = setDocMock.mock.calls[0];
    expect(ref.path).toBe('users/u1/open_days/2026-10-01');
    expect(data).toEqual({ userId: 'u1', date: '2026-10-01', createdAt: 'SERVER_TS' });
  });
  it('writes once per day: later opens the same day do nothing; the next day writes again', async () => {
    await recordOpenDay('u1', new Date(2026, 9, 1, 9));
    expect(await recordOpenDay('u1', new Date(2026, 9, 1, 18))).toBe(false);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(await recordOpenDay('u1', new Date(2026, 9, 2, 8))).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(2);
  });
  it('is remembered per account', async () => {
    await recordOpenDay('u1', new Date(2026, 9, 1));
    expect(await recordOpenDay('u2', new Date(2026, 9, 1))).toBe(true);
  });
  it('swallows a failed write and tries again on the next open', async () => {
    setDocMock.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    expect(await recordOpenDay('u1', new Date(2026, 9, 1))).toBe(false);
    expect(await recordOpenDay('u1', new Date(2026, 9, 1))).toBe(true);
  });
  it('a refusal (the day already has its doc) counts as done and is not retried', async () => {
    setDocMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(await recordOpenDay('u1', new Date(2026, 9, 1))).toBe(false);
    expect(await recordOpenDay('u1', new Date(2026, 9, 1, 12))).toBe(false);
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });
  it('does nothing without a user', async () => {
    expect(await recordOpenDay(null)).toBe(false);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
