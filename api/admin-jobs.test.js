import { describe, it, expect, vi, beforeEach } from 'vitest';

const runDaily = vi.fn(async () => ({ date: 'd' }));
const runWeekly = vi.fn(async () => ({ ncf: { action: 'promoted' } }));
const backfill = vi.fn(async () => ({ done: true }));
vi.mock('./_lib/maprNightly.js', () => ({ runDaily: (...a) => runDaily(...a), runWeekly: (...a) => runWeekly(...a) }));
vi.mock('./_lib/statsData.js', () => ({ loadStatsData: async () => ({}) }));
vi.mock('./_lib/placePacks.js', () => ({ ensureServerPlacePacks: async () => {} }));
vi.mock('./_lib/createdAtBackfill.js', () => ({ backfillCreatedAt: (...a) => backfill(...a) }));
vi.mock('./_lib/photoBackfill.js', () => ({ runPhotoBackfill: async () => ({ batch: 1 }) }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => ({}), adminAuth: async () => ({}), SERVICE_ACCOUNT_MISSING: 'FIREBASE_SERVICE_ACCOUNT is not set' }));
const { default: handler, secretOk } = await import('./admin-jobs.js');

const call = async (headers, body, method = 'POST') => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, headers, body }, res);
  return res;
};

describe('api/admin-jobs (server to server from the admin dashboard)', () => {
  beforeEach(() => {
    process.env.ADMIN_JOBS_SECRET = 's3cret';
    vi.clearAllMocks();
  });

  it('is closed without the secret, and 503 when none is configured', async () => {
    expect((await call({}, { action: 'mapr-run' })).code).toBe(401);
    expect((await call({ authorization: 'Bearer wrong!' }, { action: 'mapr-run' })).code).toBe(401);
    delete process.env.ADMIN_JOBS_SECRET;
    expect((await call({ authorization: 'Bearer s3cret' }, { action: 'mapr-run' })).code).toBe(503);
  });

  it('runs each action with the secret', async () => {
    const auth = { authorization: 'Bearer s3cret' };
    expect((await call(auth, { action: 'mapr-run' })).body).toMatchObject({ ok: true });
    expect(runWeekly).toHaveBeenCalledOnce();
    expect(runDaily).toHaveBeenCalledOnce();
    expect((await call(auth, { action: 'backfill' })).body).toEqual({ done: true });
    expect((await call(auth, { action: 'nope' })).code).toBe(400);
    expect((await call(auth, {}, 'GET')).code).toBe(405);
  });

  it('compares the secret in constant time and rejects other shapes', () => {
    expect(secretOk('Bearer abc', 'abc')).toBe(true);
    expect(secretOk('Bearer abd', 'abc')).toBe(false);
    expect(secretOk('Bearer abcd', 'abc')).toBe(false);
    expect(secretOk(undefined, 'abc')).toBe(false);
    expect(secretOk('Bearer ', '')).toBe(false);
  });
});
