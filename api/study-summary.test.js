import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let writes;
let dbThrows = false;
const empty = { docs: [] };
const fakeDb = {
  collection: (name) => ({
    doc: (id) => ({ set: async (data) => writes.push([name, id, data]) }),
    orderBy: () => ({ limit: () => ({ get: async () => empty, startAfter: () => ({ get: async () => empty }) }) }),
  }),
  collectionGroup: () => fakeDb.collection('x'),
};
vi.mock('./_lib/firebaseAdmin.js', () => ({
  adminDb: () => {
    if (dbThrows) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
    return fakeDb;
  },
  SERVICE_ACCOUNT_MISSING: 'FIREBASE_SERVICE_ACCOUNT is not set',
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

const { default: handler } = await import('./study-summary.js');
const call = async (headers = {}, method = 'GET') => {
  const res = { statusCode: 0, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, headers }, res);
  return res;
};

beforeEach(() => {
  writes = [];
  dbThrows = false;
  process.env.CRON_SECRET = 's3cret';
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('api/study-summary', () => {
  it('401 without the cron secret, or with a wrong one', async () => {
    expect((await call()).statusCode).toBe(401);
    expect((await call({ authorization: 'Bearer nope' })).statusCode).toBe(401);
    expect((await call({ authorization: 's3cret' })).statusCode).toBe(401);
    expect(writes).toEqual([]);
  });
  it('fails clearly (never open) when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = await call({ authorization: 'Bearer undefined' });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('CRON_SECRET');
    expect(writes).toEqual([]);
  });
  it('says plainly when FIREBASE_SERVICE_ACCOUNT is missing', async () => {
    dbThrows = true;
    const res = await call({ authorization: 'Bearer s3cret' });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('FIREBASE_SERVICE_ACCOUNT');
  });
  it('writes one study_summaries/{YYYY-MM-DD} document with the study shape', async () => {
    const res = await call({ authorization: 'Bearer s3cret' });
    expect(res.statusCode).toBe(200);
    expect(writes).toHaveLength(1);
    const [col, id, doc] = writes[0];
    expect(col).toBe('study_summaries');
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.date).toBe(id);
    expect(doc.createdAt).toBe('SERVER_TS');
    expect(Object.keys(doc.study).sort()).toEqual(
      ['accuracyAll', 'accuracyAtRatings', 'audience', 'bigMisses', 'byCategory', 'byCity', 'pickType', 'reach', 'scoreVsReturn', 'series', 'stalled', 'tapVsVisit', 'whatHappened'].sort(),
    );
    expect(doc.study.reach.map((r) => r.threshold)).toEqual([80, 90]);
    expect(doc.study.accuracyAtRatings.map((r) => r.ratings)).toEqual([5, 10, 20, 50, 100]);
    expect(JSON.stringify(doc)).not.toMatch(/uid|email/i);
  });
});
