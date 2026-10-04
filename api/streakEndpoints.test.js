import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake firebase-admin: one in-memory streaks/{id} doc, with a transaction that
// re-reads it, so the tests can drive the real handlers end to end.
let streakDoc;
let checkinDocs = [];
let pickDocs = [];
let cardsRated = true;
let entryRatings = { a: 'yes', b: 'yes', c: 'yes' };
const award = vi.fn(async () => {});

function ref(path) {
  return {
    path,
    get: async () => {
      if (path === 'streaks/me') return { exists: !!streakDoc, data: () => streakDoc };
      if (path.endsWith('/entries/me')) return { exists: cardsRated, data: () => ({ ratings: entryRatings }) };
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
    where: () => ({ get: async () => ({ docs: (n === 'pick_feedback' ? pickDocs : checkinDocs).map((x) => ({ data: () => x })) }) }),
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
  pickDocs = [];
  cardsRated = true;
  entryRatings = { a: 'yes', b: 'yes', c: 'yes' };
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

  it('counts 3 rated cards even when they differ from the 3 the server draws', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    entryRatings = { x: 'yes', y: 'no', z: 'yes' };
    const out = await call(handler, { dayId: utcToday() });
    expect(out.closed).toBe(true);
    expect(streakDoc.count).toBe(5);
  });

  it('does not close on 2 rated cards that are not the server deck', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    entryRatings = { x: 'yes', y: 'no' };
    const out = await call(handler, { dayId: utcToday() });
    expect(out.closed).toBe(false);
    expect(streakDoc.count).toBe(4);
  });

  it('rejects a malformed or far-off dayId', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ method: 'POST', headers: {}, body: { dayId: '2001-0-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('close-solo-streak-day: Travel Picks answers', () => {
  const tz = 240; // UTC-4, like US Eastern in summer
  const todayClient = () => {
    const n = new Date(Date.now() - tz * 60000);
    return `${n.getUTCFullYear()}-${n.getUTCMonth()}-${n.getUTCDate()}`;
  };
  const localNoonMs = () => {
    const n = new Date(Date.now() - tz * 60000);
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 12) + tz * 60000;
  };
  const answer = (id, at, verdict = 'yes') => ({ landmarkId: id, verdict, at });

  it('closes the day when 3 different landmarks were answered today, even without the daily cards', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs()), answer('p2', localNoonMs(), 'unsure'), answer('p3', localNoonMs(), 'no')];
    const out = await call(handler, { dayId: todayClient(), tzOffsetMin: tz });
    expect(out.closed).toBe(true);
    expect(streakDoc.lastCompletedDay).toBe(todayClient());
  });

  it('closes on 3 Travel Picks answers even when the streak has no city yet (the cards need one, Travel Picks do not)', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    delete streakDoc.cityId;
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs()), answer('p2', localNoonMs()), answer('p3', localNoonMs())];
    const out = await call(handler, { dayId: todayClient(), tzOffsetMin: tz });
    expect(out.closed).toBe(true);
    // ...but with fewer answers and no city it still reports why.
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs())];
    expect((await call(handler, { dayId: todayClient(), tzOffsetMin: tz })).reason).toBe('no-city');
  });

  it("also counts 0-point 'Rate a Landmark' ratings, exactly like the N/3 counter, and mixes them with Travel Picks answers", async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    const claim = (id, ratingOnly = true) => ({ landmarkId: id, ratingOnly, visited: !ratingOnly, points: ratingOnly ? 0 : 100, createdAt: { toMillis: () => localNoonMs() } });
    checkinDocs = [claim('r1'), claim('r2'), claim('visit', false)];
    pickDocs = [answer('p1', localNoonMs())];
    const out = await call(handler, { dayId: todayClient(), tzOffsetMin: tz });
    expect(out.closed).toBe(true); // r1 + r2 + p1 = 3; the real check-in does not count
  });

  it('reports how many it counted when the day is not secured, so the app can say why', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs()), answer('p2', localNoonMs())];
    const out = await call(handler, { dayId: todayClient(), tzOffsetMin: tz });
    expect(out).toMatchObject({ closed: false, counted: 2, needed: 3, window: 'ok' });
    const noTz = await call(handler, { dayId: todayClient() });
    expect(noTz).toMatchObject({ closed: false, counted: 0, window: 'no-timezone' });
  });

  it('does not close on 2 answers, repeats of one landmark, or answers from another day', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    // An old last day: beforeEach's UTC yesterday IS the client's today in the
    // evening (UTC-4 after 8 pm), which would read as "already closed".
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs()), answer('p1', localNoonMs()), answer('p2', localNoonMs() - 86400000), answer('p3', localNoonMs())];
    const out = await call(handler, { dayId: todayClient(), tzOffsetMin: tz });
    expect(out.closed).toBe(false);
  });

  it('ignores Travel Picks answers when the client sends no usable timezone offset', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = key(new Date(Date.UTC(2020, 0, 1)));
    pickDocs = [answer('p1', localNoonMs()), answer('p2', localNoonMs()), answer('p3', localNoonMs())];
    expect((await call(handler, { dayId: todayClient() })).closed).toBe(false);
    expect((await call(handler, { dayId: todayClient(), tzOffsetMin: 99999 })).closed).toBe(false);
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
