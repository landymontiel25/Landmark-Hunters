import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake firebase-admin: one in-memory streaks/{id} doc, its days/{dayId} docs
// (the server-drawn deck), and a transaction that re-reads it, so the tests
// can drive the real handlers end to end.
let streakDoc;
let checkinDocs = [];
let pickDocs = [];
let cardsRated = true;
let entryRatings = { a: 'yes', b: 'yes', c: 'yes' };
let dualEntries;
let dayDocs = {};
const award = vi.fn(async () => {});

function ref(path) {
  return {
    path,
    get: async () => {
      if (path === 'streaks/me') return { exists: !!streakDoc, data: () => streakDoc };
      if (path.endsWith('/entries/me')) return { exists: cardsRated, data: () => ({ ratings: entryRatings }) };
      if (/^streaks\/me\/days\/[^/]+$/.test(path)) return { exists: !!dayDocs[path], data: () => dayDocs[path] };
      return { exists: false, data: () => undefined };
    },
    update: async (u) => Object.assign(streakDoc, u),
    set: async (d) => {
      dayDocs[path] = { ...(dayDocs[path] || {}), ...d };
    },
    collection: (n) => ({
      doc: (id) => ref(`${path}/${n}/${id}`),
      get: async () => ({ docs: Object.entries(dualEntries).map(([id, e]) => ({ id, data: () => e })) }),
    }),
  };
}
// Pick answers carry the time Firestore wrote them (updateTimeMs), which is
// all the server reads; `at` is what a phone claims and is ignored.
const snap = (x) => ({ data: () => x, updateTimeMs: x.writtenMs });
const fakeDb = {
  collection: (n) => ({
    doc: (id) => ref(`${n}/${id}`),
    where: () => ({ get: async () => ({ docs: (n === 'pick_feedback' ? pickDocs : checkinDocs).map(snap) }) }),
  }),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, u) => r.update(u), set: (r, d) => r.set?.(d) }),
};

vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => ({ uid: 'me' }) }));
vi.mock('./_lib/rateLimit.js', () => ({ isRateLimited: () => false }));
vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } }));
vi.mock('../src/lib/sharedDeck.js', () => ({ pickDailyCardIds: () => ['a', 'b', 'c'] }));
// The streak endpoints pay inside their close transaction: `award` records
// each member's payout (db, uid, name, points, dayId).
vi.mock('./_lib/leaderboardPoints.js', () => ({
  awardLeaderboardPointsServer: (...a) => award(...a),
  leaderboardPointWrites: (...a) => {
    award(...a);
    return [];
  },
  cleanUserName: (n) => n || 'A traveler',
}));

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

// Every streak here is pinned to UTC, so the server's "today" is utcToday().
const UTC = { zone: 'UTC', setAtMs: 0 };
const nowMs = () => Date.now();
const verifiedVisitNow = () => ({ landmarkId: 'v', visited: true, ratingOnly: false, presence: { verified: true }, createdAt: { toMillis: () => nowMs() } });

beforeEach(() => {
  award.mockClear();
  checkinDocs = [];
  pickDocs = [];
  dayDocs = {};
  cardsRated = true;
  entryRatings = { a: 'yes', b: 'yes', c: 'yes' };
  dualEntries = { me: { ratings: { a: 'yes', b: 'no', c: 'unsure' }, guesses: { a: 'yes', b: 'yes', c: 'yes' } } };
  streakDoc = { mode: 'solo', memberIds: ['me'], cityId: 'x', count: 4, best: 4, lastCompletedDay: utcYesterday(), frozenDays: [], tz: { ...UTC } };
});

describe('close-solo-streak-day', () => {
  it('pays out once when two calls overlap (the second sees the day already closed)', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const [a, b] = await Promise.all([call(handler, { dayId: utcToday() }), call(handler, { dayId: utcToday() })]);
    expect(streakDoc.count).toBe(5);
    expect(award).toHaveBeenCalledTimes(1);
    expect([a.already, b.already].filter(Boolean)).toHaveLength(1);
  });

  it('pays a milestone the first time the streak reaches it, and not again after a reset', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const { SOLO_DAY_POINTS, SOLO_MILESTONE_POINTS } = await import('./_lib/closeSoloStreakDay.js');
    streakDoc = { ...streakDoc, count: 2, best: 2 };
    let out = await call(handler, { dayId: utcToday() });
    expect(streakDoc.count).toBe(3);
    expect(out.milestoneAwarded).toBe(SOLO_MILESTONE_POINTS[3]);
    expect(award.mock.calls[0][3]).toBe(SOLO_DAY_POINTS + SOLO_MILESTONE_POINTS[3]);
    // Broke and climbed back to 3: the best is still 18, so no second payout.
    award.mockClear();
    streakDoc = { ...streakDoc, count: 2, best: 18, lastCompletedDay: utcYesterday() };
    out = await call(handler, { dayId: utcToday() });
    expect(streakDoc.count).toBe(3);
    expect(out.milestoneAwarded).toBe(null);
    expect(award.mock.calls[0][3]).toBe(SOLO_DAY_POINTS);
  });

  it('the day is the server\'s: naming yesterday when today is closed changes nothing', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    streakDoc.lastCompletedDay = utcToday();
    const out = await call(handler, { dayId: utcYesterday() });
    expect(out).toMatchObject({ already: true, dayId: utcToday() });
    expect(streakDoc.count).toBe(4);
    expect(award).not.toHaveBeenCalled();
  });

  it('exploit: 3 made-up card ids in the entry no longer close the day; only the server\'s 3 count', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    entryRatings = { x: 'yes', y: 'no', z: 'yes' };
    const out = await call(handler, { dayId: utcToday() });
    expect(out.closed).toBe(false);
    expect(streakDoc.count).toBe(4);
    expect(award).not.toHaveBeenCalled();
  });

  it('stores the deck it drew for the day, and a non-answer (a number) is not a rating', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    entryRatings = { a: 1, b: 1, c: 1 };
    expect((await call(handler, {})).closed).toBe(false);
    expect(dayDocs[`streaks/me/days/${utcToday()}`].cards).toEqual(['a', 'b', 'c']);
    const deck = await call(handler, { deckOnly: true });
    expect(deck).toMatchObject({ ok: true, dayId: utcToday(), cards: ['a', 'b', 'c'] });
  });

  it('does not close on 2 rated cards that are not the server deck', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    entryRatings = { x: 'yes', y: 'no' };
    const out = await call(handler, { dayId: utcToday() });
    expect(out.closed).toBe(false);
    expect(streakDoc.count).toBe(4);
  });

  it('ignores a far-off dayId from the phone: it closes the server\'s today', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    const out = await call(handler, { dayId: '2001-0-1' });
    expect(out.closed).toBe(true);
    expect(streakDoc.lastCompletedDay).toBe(utcToday());
  });

  it('a phone can\'t move the pinned time zone again within 20 hours', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    streakDoc.tz = { zone: 'UTC', setAtMs: Date.now() - 60 * 1000 };
    await call(handler, { timeZone: 'Pacific/Kiritimati' });
    expect(streakDoc.tz.zone).toBe('UTC');
    streakDoc.tz = { zone: 'UTC', setAtMs: Date.now() - 21 * 3600 * 1000 };
    streakDoc.lastCompletedDay = utcToday();
    await call(handler, { timeZone: 'America/New_York' });
    expect(streakDoc.tz.zone).toBe('America/New_York');
  });
});

describe('close-solo-streak-day: Travel Picks answers (timed by Firestore, not the phone)', () => {
  const answer = (id, writtenMs, verdict = 'yes', at = writtenMs) => ({ landmarkId: id, verdict, at, writtenMs });
  const old = () => key(new Date(Date.UTC(2020, 0, 1)));

  it('closes the day when 3 different landmarks were answered today, even without the daily cards', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    pickDocs = [answer('p1', nowMs()), answer('p2', nowMs(), 'unsure'), answer('p3', nowMs(), 'no')];
    const out = await call(handler, {});
    expect(out.closed).toBe(true);
    expect(streakDoc.lastCompletedDay).toBe(utcToday());
  });

  it('exploit: answers backdated by the phone (`at`) count for the day Firestore wrote them, not the claimed day', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    // Written yesterday, claiming today: not today's.
    pickDocs = [answer('p1', nowMs() - 86400000 * 2, 'yes', nowMs()), answer('p2', nowMs() - 86400000 * 2, 'yes', nowMs()), answer('p3', nowMs() - 86400000 * 2, 'yes', nowMs())];
    expect((await call(handler, {})).closed).toBe(false);
  });

  it('closes on 3 Travel Picks answers even when the streak has no city yet (the cards need one, Travel Picks do not)', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    delete streakDoc.cityId;
    streakDoc.lastCompletedDay = old();
    pickDocs = [answer('p1', nowMs()), answer('p2', nowMs()), answer('p3', nowMs())];
    expect((await call(handler, {})).closed).toBe(true);
    streakDoc.lastCompletedDay = old();
    pickDocs = [answer('p1', nowMs())];
    expect((await call(handler, {})).reason).toBe('no-city');
  });

  it("also counts 0-point 'Rate a Landmark' ratings and check-ins as answered landmarks", async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    const claim = (id, ratingOnly = true) => ({ landmarkId: id, ratingOnly, visited: !ratingOnly, points: 0, createdAt: { toMillis: () => nowMs() } });
    checkinDocs = [claim('r1'), claim('r2')];
    pickDocs = [answer('p1', nowMs())];
    expect((await call(handler, {})).closed).toBe(true);
  });

  it('a verified check-in today secures the day by itself; an unverified one does not', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    checkinDocs = [{ ...verifiedVisitNow(), presence: { verified: false, reason: 'too-far' } }];
    expect((await call(handler, {})).closed).toBe(false);
    checkinDocs = [verifiedVisitNow()];
    expect((await call(handler, {})).closed).toBe(true);
  });

  it('reports how many it counted when the day is not secured, and says when there is no time zone', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    pickDocs = [answer('p1', nowMs()), answer('p2', nowMs())];
    expect(await call(handler, {})).toMatchObject({ closed: false, counted: 2, needed: 3 });
    delete streakDoc.tz;
    expect(await call(handler, {})).toMatchObject({ closed: false, reason: 'no-timezone' });
  });

  it('does not close on 2 answers, repeats of one landmark, or answers written another day', async () => {
    const { default: handler } = await import('./close-solo-streak-day.js');
    cardsRated = false;
    streakDoc.lastCompletedDay = old();
    pickDocs = [answer('p1', nowMs()), answer('p1', nowMs()), answer('p2', nowMs() - 86400000 * 2), answer('p3', nowMs())];
    expect((await call(handler, {})).closed).toBe(false);
  });
});

describe('use-solo-streak-freeze', () => {
  it("freezes the server's day in the streak's pinned zone, whatever day the phone names", async () => {
    const { default: handler } = await import('./use-solo-streak-freeze.js');
    const [y, m] = utcToday().split('-');
    streakDoc.freezeMonth = `${y}-${m}`;
    streakDoc.freezesLeft = 1;
    const out = await call(handler, { dayId: utcYesterday() });
    expect(out.ok).toBe(true);
    expect(streakDoc.frozenDays).toEqual([utcToday()]);
  });
});

describe('pair endpoints reject a solo streak doc', () => {
  for (const file of ['./use-streak-freeze.js', './close-streak-day.js', './complete-recovery-mission.js']) {
    it(file, async () => {
      const { default: handler } = await import(file);
      streakDoc.recoveryOpenUntil = Date.now() + 1e6;
      const before = JSON.stringify(streakDoc);
      const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
      await handler({ method: 'POST', headers: {}, body: { pairId: 'me', dayId: utcToday() } }, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(JSON.stringify(streakDoc)).toBe(before);
      expect(award).not.toHaveBeenCalled();
    });
  }
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

  it('reset works on an older pair doc with no mode field, and still refuses a solo doc', async () => {
    const { default: handler } = await import('./reset-dual-streak.js');
    streakDoc = { memberIds: ['me', 'you'], count: 5, best: 9 };
    const out = await call(handler, { pairId: 'me', confirm: 'RESET' });
    expect(out.ok).toBe(true);
    expect(streakDoc.count).toBe(0);
    streakDoc = { mode: 'solo', memberIds: ['me'], count: 5, best: 9 };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ method: 'POST', headers: {}, body: { pairId: 'me', confirm: 'RESET' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(streakDoc.count).toBe(5);
  });

  it('dual: pays every member in the close, and a milestone only the first time', async () => {
    const { default: handler, DUAL_DAY_POINTS, DUAL_MILESTONE_POINTS } = await import('./close-streak-day.js');
    streakDoc = { mode: 'dual', memberIds: ['me'], cityId: 'x', count: 2, best: 2, lastCompletedDay: utcYesterday(), frozenDays: [], tz: { ...UTC } };
    checkinDocs = [verifiedVisitNow()];
    await call(handler, { pairId: 'me', dayId: utcToday() });
    expect(streakDoc.count).toBe(3);
    expect(award.mock.calls.map((c) => [c[1], c[3]])).toEqual([['me', DUAL_DAY_POINTS + DUAL_MILESTONE_POINTS[3]]]);
    award.mockClear();
    streakDoc = { ...streakDoc, count: 2, best: 30, lastCompletedDay: utcYesterday() };
    await call(handler, { pairId: 'me', dayId: utcToday() });
    expect(award.mock.calls.map((c) => c[3])).toEqual([DUAL_DAY_POINTS]);
  });

  it('does not open a recovery mission when freezes were last refreshed in an earlier month', async () => {
    const { default: handler } = await import('./close-streak-day.js');
    streakDoc = {
      mode: 'dual', memberIds: ['me'], cityId: 'x', count: 6, best: 6, lastCompletedDay: '2000-0-1',
      freezesLeft: 0, freezeMonth: '2000-0', frozenDays: [], tz: { ...UTC },
    };
    checkinDocs = [verifiedVisitNow()];
    await call(handler, { pairId: 'me', dayId: utcToday() });
    expect(streakDoc.count).toBe(1);
    expect(streakDoc.recoveryOpenUntil).toBeUndefined();
  });

  it("does not open a recovery mission when this month's was already used", async () => {
    const { default: handler } = await import('./close-streak-day.js');
    const n = new Date();
    const today = utcToday();
    const [y, m] = today.split('-');
    streakDoc = {
      mode: 'dual', memberIds: ['me'], cityId: 'x', count: 6, best: 6, lastCompletedDay: '2000-0-1',
      freezesLeft: 0, freezeMonth: `${y}-${m}`, frozenDays: [], recoveryUsedMonth: `${n.getFullYear()}-${n.getMonth()}`, tz: { ...UTC },
    };
    checkinDocs = [verifiedVisitNow()];
    await call(handler, { pairId: 'me', dayId: today });
    expect(streakDoc.count).toBe(1);
    expect(streakDoc.recoveryOpenUntil).toBeUndefined();
    // Control: same state without the used month does open one.
    streakDoc = { ...streakDoc, count: 6, lastCompletedDay: '2000-0-1', recoveryUsedMonth: null };
    await call(handler, { pairId: 'me', dayId: today });
    expect(streakDoc.recoveryOpenUntil).toBeGreaterThan(Date.now());
  });

  it('exploit: two accounts answering from a couch do not close a dual day without a verified visit', async () => {
    const { default: handler } = await import('./close-streak-day.js');
    streakDoc = { mode: 'dual', memberIds: ['me'], cityId: 'x', count: 2, best: 2, lastCompletedDay: utcYesterday(), frozenDays: [], tz: { ...UTC } };
    checkinDocs = [{ ...verifiedVisitNow(), presence: { verified: false, reason: 'mocked' } }];
    const out = await call(handler, { pairId: 'me' });
    expect(out).toMatchObject({ closed: false, reason: 'needs-verified-checkin' });
    expect(streakDoc.count).toBe(2);
    expect(award).not.toHaveBeenCalled();
  });

  it('scores each member\'s guesses against what the partner really rated, and stores the deck and scores', async () => {
    const { default: handler, scoreGuesses } = await import('./close-streak-day.js');
    expect(scoreGuesses(['a', 'b', 'c'], { guesses: { a: 'yes', b: 'yes', c: 'no' } }, { ratings: { a: 'yes', b: 'no', c: 'no' } })).toBe(2);
    expect(scoreGuesses(['a'], { guesses: { a: 1 } }, { ratings: { a: 1 } })).toBe(0);
    streakDoc = { mode: 'dual', memberIds: ['me', 'you'], cityId: 'x', count: 2, best: 2, lastCompletedDay: utcYesterday(), frozenDays: [], tz: { ...UTC } };
    dualEntries = {
      me: { ratings: { a: 'yes', b: 'no', c: 'unsure' }, guesses: { a: 'yes', b: 'yes', c: 'yes' } },
      you: { ratings: { a: 'yes', b: 'yes', c: 'no' }, guesses: { a: 'yes', b: 'no', c: 'unsure' } },
    };
    checkinDocs = [verifiedVisitNow()];
    const out = await call(handler, { pairId: 'me' });
    expect(out.closed).toBe(true);
    expect(out.scores).toEqual({ me: 2, you: 3 });
    expect(dayDocs[`streaks/me/days/${utcToday()}`]).toMatchObject({ cards: ['a', 'b', 'c'], scores: { me: 2, you: 3 } });
  });

  it('answers that are not real verdicts (numbers, made-up ids) never count', async () => {
    const { default: handler } = await import('./close-streak-day.js');
    streakDoc = { mode: 'dual', memberIds: ['me'], cityId: 'x', count: 2, best: 2, lastCompletedDay: utcYesterday(), frozenDays: [], tz: { ...UTC } };
    dualEntries = { me: { ratings: { a: 1, b: 1, c: 1 }, guesses: { a: 1, b: 1, c: 1 } } };
    checkinDocs = [verifiedVisitNow()];
    expect((await call(handler, { pairId: 'me' })).closed).toBe(false);
  });
});
