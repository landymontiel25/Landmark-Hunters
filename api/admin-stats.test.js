import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake Admin SDK database: collections of { id, data, parent? } rows, with
// just the query surface the stats code uses (orderBy, limit, startAfter, get).
const DAY = 86400000;
const T0 = Date.parse('2026-09-01T00:00:00Z');
const ts = (ms) => ({ toMillis: () => ms });
const UIDS = ['uid-alice-1', 'uid-bob-2', 'uid-cara-3'];
const EMAILS = ['alice@example.com', 'bob@example.com', 'cara@example.com'];
const NAMES = ['Alice Anderson', 'Bob Brown', 'Cara Clark'];

let tables;
let writes;
function buildTables() {
  const sub = (uid, name, id, data) => ({ id, data, ref: { parent: { parent: { id: uid } } }, _col: name });
  const t = {
    users: UIDS.map((uid, i) => ({ id: uid, data: { uid, displayName: NAMES[i], email: EMAILS[i], username: NAMES[i].split(' ')[0].toLowerCase(), homeCoords: { lat: 37.1, lng: -122.2 }, createdAt: ts(T0 + i * DAY) } })),
    reviews: UIDS.flatMap((uid, i) =>
      Array.from({ length: 3 }, (_, k) => ({
        id: `${uid}_l${k}`,
        data: { userId: uid, userName: NAMES[i], landmarkId: `l${k}`, ratingTier: 'highly-recommend', ratedAt: T0 + i * DAY + 1000 * (k + 1), updatedAt: ts(T0 + i * DAY + 1000 * (k + 1)), comment: `${EMAILS[i]} loved it`, disagreement: k === 0 ? { reason: 'food', comment: 'private words' } : null },
      })),
    ),
    pick_feedback: [],
    recommendation_log: [],
    checkins: [{ id: `${UIDS[0]}_l0`, data: { userId: UIDS[0], userName: NAMES[0], createdAt: ts(T0 + 3600000), ratingOnly: false, distanceMeters: 12, gpsAccuracyMeters: 5 } }],
    referrals: [{ id: UIDS[1], data: { referrerUid: UIDS[0], referrerUsername: 'alice', referredUid: UIDS[1], createdAt: ts(T0 + DAY) } }],
    study_summaries: [],
    open_days: [sub(UIDS[0], 'open_days', '2026-09-01', {}), sub(UIDS[0], 'open_days', '2026-09-02', {})],
    place_scores: [sub(UIDS[0], 'place_scores', 'l0', { landmarkId: 'l0', region: 'sf', categories: ['food'], latestLevel: 'positive', latestAt: T0 + 5000 })],
    taste_history: [sub(UIDS[0], 'taste_history', 'h1', { at: T0 + 2 * DAY, score: 85, baselineScore: 60, ratingsCount: 12 })],
  };
  return t;
}
const fakeDb = {
  collection: (name) => ({
    doc: (id) => ({ set: async (data) => writes.push([name, id, data]) }),
    orderBy: () => ({ limit: (n) => makeLimited(name, n) }),
  }),
  collectionGroup: (name) => fakeDb.collection(name),
};
function makeLimited(name, n, after) {
  return {
    get: async () => {
      const all = tables[name] || [];
      const from = after ? all.indexOf(after) + 1 : 0;
      const rows = all.slice(from, from + n);
      return { docs: rows.map((r) => ({ id: r.id, ref: r.ref || { parent: { parent: null } }, _row: r, data: () => r.data })) };
    },
    startAfter: (doc) => makeLimited(name, n, doc._row),
  };
}

let account;
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => account }));
let dbThrows = false;
vi.mock('./_lib/firebaseAdmin.js', () => ({
  adminDb: () => {
    if (dbThrows) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
    return fakeDb;
  },
  adminAuth: () => ({ getUsers: async () => ({ users: [] }) }),
  SERVICE_ACCOUNT_MISSING: 'FIREBASE_SERVICE_ACCOUNT is not set',
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  Timestamp: { fromMillis: (ms) => ({ ms }) },
}));

const { default: handler, _resetStatsCache } = await import('./admin-stats.js');

const call = async (req = {}) => {
  const res = { statusCode: 0, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, setHeader() {} };
  await handler({ method: 'GET', headers: {}, ...req }, res);
  return res;
};

beforeEach(() => {
  tables = buildTables();
  writes = [];
  _resetStatsCache();
  account = { uid: UIDS[0], email: 'landymontiel25@gmail.com', emailVerified: true };
  dbThrows = false;
});

describe('api/admin-stats: who may call it', () => {
  it('no token is 401', async () => {
    account = null;
    const res = await call();
    expect(res.statusCode).toBe(401);
  });
  it('a signed-in non-admin is 403', async () => {
    account = { uid: UIDS[1], email: EMAILS[1], emailVerified: true };
    expect((await call()).statusCode).toBe(403);
  });
  it('the admin email with an unverified address is 403', async () => {
    account = { uid: 'x', email: 'landymontiel25@gmail.com', emailVerified: false };
    expect((await call()).statusCode).toBe(403);
  });
  it('the admin is 200, and the email is matched case-insensitively', async () => {
    account = { uid: 'x', email: 'LandyMontiel25@gmail.com', emailVerified: true };
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body.metrics.length).toBeGreaterThan(8);
  });
  it('POST backfill is admin-only as well', async () => {
    account = { uid: UIDS[1], email: EMAILS[1], emailVerified: true };
    expect((await call({ method: 'POST', body: { action: 'backfill' } })).statusCode).toBe(403);
  });
  it('says plainly when FIREBASE_SERVICE_ACCOUNT is missing instead of crashing', async () => {
    dbThrows = true;
    const res = await call();
    dbThrows = false;
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('FIREBASE_SERVICE_ACCOUNT');
  });
});

describe('api/admin-stats: the response is totals only', () => {
  const FORBIDDEN_KEY = /^(uid|userId|user_id|email|name|userName|displayName|username|photoURL|lat|lng|latitude|longitude|location|homeCoords|homeAddress|comment|landmarkId|referrerUid|referredUid)$/i;
  const walk = (v, visit) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { visit(k, x); walk(x, visit); }
    else visit(null, v);
  };

  it('has no identifying keys anywhere, and no user ids, emails, names or text from the fixture in any value', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    const keys = [];
    walk(res.body, (k) => k && keys.push(k));
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    const json = JSON.stringify(res.body);
    for (const secret of [...UIDS, ...EMAILS, ...NAMES, 'private words', 'loved it', '37.1', '-122.2', 'alice']) {
      expect(json.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
  it('still counts the fixture correctly', async () => {
    const res = await call();
    expect(res.body.totals).toEqual({ users: 3, openDays: 2 });
    const ref = res.body.metrics.find((m) => m.id === 'referralCoefficient');
    expect(ref.value).toBe(1);
    expect(res.body.study.whatHappened.counts.food).toBe(3);
    expect(res.body.study.accuracyAll.users).toBe(1);
  });
  it('caches the summary briefly (a second call does not re-read)', async () => {
    const first = await call();
    tables.users = [];
    const second = await call();
    expect(second.body.generatedAt).toBe(first.body.generatedAt);
    expect(second.body.totals.users).toBe(3);
    _resetStatsCache();
    expect((await call()).body.totals.users).toBe(0);
  });
});
