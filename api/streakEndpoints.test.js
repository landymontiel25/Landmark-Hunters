import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake firebase-admin: one in-memory streaks/{id} doc, with a transaction that
// re-reads it, so the tests can drive the real handlers end to end.
let streakDoc;
let checkinDocs = [];
const award = vi.fn(async () => {});

function ref(path) {
  return {
    path,
    get: async () => {
      if (path === 'streaks/me') return { exists: !!streakDoc, data: () => streakDoc };
      if (path.endsWith('/entries/me')) return { exists: true, data: () => ({ ratings: { a: 'yes', b: 'yes', c: 'yes' } }) };
      return { exists: false, data: () => undefined };
    },
    update: async (u) => Object.assign(streakDoc, u),
    collection: (n) => ({
      doc: (id) => ref(`${path}/${n}/${id}`),
      get: async () => ({ docs: [{ id: 'me', data: () => ({ ratings: { a: 1, b: 1, c: 1 }, guesses: { a: 1, b: 1, c: 1 } }) }] }),
    }),
  };
}
const fakeDb = {
  collection: (n) => ({
    doc: (id) => ref(`${n}/${id}`),
    where: () => ({ get: async () => ({ docs: checkinDocs.map((x) => ({ data: () => x })) }) }),
  }),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, u) => r.update(u) }),
};

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => ({ uid: 'me' }) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } }));
vi.mock('../src/lib/sharedDeck.js', () => ({ pickDailyCardIds: () => ['a', 'b', 'c'] }));
vi.mock('./_lib/leaderboardPoints.js', () => ({ awardLeaderboardPointsServer: (...a) => award(...a) }));

const call = async (handler, body) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  await handler({ method: 'POST', headers: {}, body }, res);
  return res.json.mock.calls[0][0];
};
const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const utcToday = () => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${n.getUTCMonth()}-${n.getUTCDate()}`;
};
const utcYesterday = () => {
  const n = new Date();
  return key(new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 1));
};

beforeEach(() => {
  award.mockClear();
  checkinDocs = [];
  streakDoc = { mode: 'solo', memberIds: ['me'], cityId: 'x', count: 4, best: 4, lastCompletedDay: utcYesterday(), frozenDays: [] };
});

describe('close-solo-streak-day', () => {
  it('pays out once when two calls overlap (the second sees the day already closed)', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const [a, b] = await Promise.all([call(handler, { dayId: utcToday() }), call(handler, { dayId: utcToday() })]);
    expect(streakDoc.count).toBe(5);
    expect(award).toHaveBeenCalledTimes(1);
    expect([a.already, b.already].filter(Boolean)).toHaveLength(1);
  });

  it('does not move the streak backwards for an older day', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    streakDoc.lastCompletedDay = utcToday();
    const out = await call(handler, { dayId: utcYesterday() });
    expect(out.closed).toBe(false);
    expect(streakDoc.count).toBe(4);
    expect(award).not.toHaveBeenCalled();
  });

  it('rejects a malformed or far-off dayId', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ method: 'POST', headers: {}, body: { dayId: '2001-0-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('use-solo-streak-freeze', () => {
  it("freezes the caller's local day, not the server's UTC day", async () => {
    const { default: handler } = await import('./use-solo-streak-freeze.js');
    // A client whose local day is one behind UTC (a US evening).
    const clientDay = utcYesterday();
    const [y, m] = clientDay.split('-');
    streakDoc.freezeMonth = `${y}-${m}`;
    streakDoc.freezesLeft = 1;
    const out = await call(handler, { dayId: clientDay });
    expect(out.ok).toBe(true);
    expect(streakDoc.frozenDays).toEqual([clientDay]);
  });
});

describe('dual streak fixes', () => {
  it('recovery mission restores prior count plus days completed since the break', async () => {
    const { default: handler } = await import('./complete-recovery-mission.js');
    streakDoc = { mode: 'dual', memberIds: ['me', 'you'], count: 3, best: 10, recoveryOpenUntil: Date.now() + 1e6, recoveryPriorCount: 10 };
    checkinDocs = [{ visited: true, landmarkId: 'a', createdAt: { toMillis: () => Date.now() } }];
    const out = await call(handler, { pairId: 'me' });
    expect(out.ok).toBe(true);
    expect(streakDoc.count).toBe(13);
  });

  it('reset requires typed confirmation and keeps best', async () => {
    const { default: handler } = await import('./reset-dual-streak.js');
    streakDoc = { mode: 'dual', memberIds: ['me', 'you'], count: 5, best: 9 };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ method: 'POST', headers: {}, body: { pairId: 'me' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(streakDoc.count).toBe(5);
    await call(handler, { pairId: 'me', confirm: 'RESET' });
    expect(streakDoc.count).toBe(0);
    expect(streakDoc.best).toBe(9);
  });

  it('does not open a recovery mission when freezes were last refreshed in an earlier month', async () => {
    const { default: handler } = await import('./close-streak-day.js');
    streakDoc = {
      mode: 'dual', memberIds: ['me'], cityId: 'x', count: 6, best: 6, lastCompletedDay: '2000-0-1',
      freezesLeft: 0, freezeMonth: '2000-0', frozenDays: [],
    };
    await call(handler, { pairId: 'me', dayId: utcToday() });
    expect(streakDoc.count).toBe(1);
    expect(streakDoc.recoveryOpenUntil).toBeUndefined();
  });
});
