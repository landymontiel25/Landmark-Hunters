import { describe, it, expect, vi, beforeEach } from 'vitest';

const runDaily = vi.fn(async () => ({ date: '2026-10-04' }));
const runWeekly = vi.fn(async () => ({ ncf: { action: 'promoted' } }));
vi.mock('./_lib/maprNightly.js', () => ({ runDaily: (...a) => runDaily(...a), runWeekly: (...a) => runWeekly(...a) }));
vi.mock('./_lib/statsData.js', () => ({ loadStatsData: async () => ({ truncated: [] }) }));
vi.mock('./_lib/placePacks.js', () => ({ ensureServerPlacePacks: async () => {} }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => ({}), SERVICE_ACCOUNT_MISSING: 'FIREBASE_SERVICE_ACCOUNT is not set' }));
const { default: handler } = await import('./mapr-nightly.js');

function call(headers = {}, query = {}) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ method: 'GET', headers, query }, res).then(() => res);
}

describe('api/mapr-nightly', () => {
  beforeEach(() => {
    runDaily.mockClear();
    runWeekly.mockClear();
    process.env.CRON_SECRET = 'sekret';
  });

  it('refuses without the cron secret', async () => {
    expect((await call()).code).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: 'Bearer sekret' })).code).toBe(503);
  });

  it('runs the daily part every night and the weekly part on Mondays or ?weekly=1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T00:23:00Z')); // Tuesday
    let r = await call({ authorization: 'Bearer sekret' });
    expect(r.code).toBe(200);
    expect(runDaily).toHaveBeenCalledOnce();
    expect(runWeekly).not.toHaveBeenCalled();
    r = await call({ authorization: 'Bearer sekret' }, { weekly: '1' });
    expect(runWeekly).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date('2026-10-05T00:23:00Z')); // Monday
    await call({ authorization: 'Bearer sekret' });
    expect(runWeekly).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('still runs the daily report when the weekly models fail', async () => {
    runWeekly.mockImplementationOnce(async () => { throw new Error('training blew up'); });
    const r = await call({ authorization: 'Bearer sekret' }, { weekly: '1' });
    expect(runDaily).toHaveBeenCalledOnce();
    expect(r.code).toBe(500);
    expect(r.body.daily).toEqual({ date: '2026-10-04' });
  });
});
