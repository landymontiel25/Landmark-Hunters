import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' }, FieldPath: { documentId: () => '__id__' } }));

const { computeAllSimilarity, liveAccuracy, ncfPositives, postToSlack, runDaily, runNcfWeekly, runWeekly, trendingCounts } = await import('./maprNightly.js');

const DAY = 86400000;
const NOW = Date.parse('2026-10-05T00:30:00Z'); // a Monday

// In-memory stand-in for the Admin SDK surface the job uses.
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const snapOf = (name, id) => ({ id, exists: col(name).has(id), data: () => col(name).get(id), ref: ref(name, id) });
  const ref = (name, id) => ({
    _path: [name, id],
    get: async () => snapOf(name, id),
    set: async (data, opts) => {
      col(name).set(id, opts?.merge ? { ...(col(name).get(id) || {}), ...data } : data);
    },
  });
  const all = (name) => [...col(name).keys()].map((id) => snapOf(name, id));
  const db = {
    store,
    collection: (name) => ({
      doc: (id) => ref(name, id),
      get: async () => ({ docs: all(name) }),
      where: (f, _op, v) => ({ get: async () => ({ docs: all(name).filter((d) => d.data()?.[f] === v) }) }),
      orderBy: (f, dir) => ({
        limit: (n) => ({
          get: async () => {
            const docs = all(name).sort((a, b) => (a.data()[f] < b.data()[f] ? -1 : 1));
            return { docs: (dir === 'desc' ? docs.reverse() : docs).slice(0, n) };
          },
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        set: (r, data, opts) => ops.push(() => r.set(data, opts)),
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
  };
  return db;
}

// Two clusters of Milan places visited by two groups of users.
const MILAN_IDS = ['duomo', 'brera', 'navigli', 'sempione', 'cenacolo', 'scala', 'pinacoteca', 'darsena'];
function dataset() {
  const checkins = [];
  for (let u = 0; u < 16; u++) {
    const group = u % 2 ? MILAN_IDS.slice(0, 4) : MILAN_IDS.slice(4);
    group.forEach((id, k) => checkins.push({ userId: `u${u}`, landmarkId: id, region: 'milan', createdAt: NOW - ((u * 5 + k * 17) % 85) * DAY - 1000, ratingOnly: false }));
  }
  return {
    users: [],
    openDays: [{ uid: 'u1', date: '2026-10-04' }],
    reviews: [{ userId: 'u1', landmarkId: 'duomo', region: 'milan', ratingTier: 'highly-recommend', ratedAt: NOW - 2 * DAY }],
    pickFeedback: [],
    recommendationLog: [{ userId: 'u1', landmarkId: 'brera', region: 'milan', setId: 's', shownAt: NOW - 20 * 3600000, isTest: false, distanceKm: 0.8 }],
    checkins,
    truncated: [],
  };
}
const landmarks = MILAN_IDS.map((id, i) => ({ id, regionId: 'milan', categories: [i < 4 ? 'art-museums' : 'parks-nature'] }));

describe('inputs', () => {
  it('ncfPositives: real check-ins and loved ratings, keyed region/id', () => {
    const p = ncfPositives({ checkins: [{ userId: 'a', landmarkId: 'x', region: 'r', createdAt: 1 }, { userId: 'a', landmarkId: 'y', region: 'r', createdAt: 1, ratingOnly: true }], reviews: [{ userId: 'a', landmarkId: 'z', region: 'r', ratingTier: 'highly-recommend', ratedAt: 2 }, { userId: 'a', landmarkId: 'w', region: 'r', ratingTier: 'worth-trying', ratedAt: 2 }] });
    expect(p.map((x) => x.itemKey)).toEqual(['r/x', 'r/z']);
  });

  it('trendingCounts: last 7 days only, most first', () => {
    const t = trendingCounts({ checkins: [{ landmarkId: 'a', region: 'r', createdAt: NOW - DAY }, { landmarkId: 'a', region: 'r', createdAt: NOW - 2 * DAY }, { landmarkId: 'b', region: 'r', createdAt: NOW - DAY }, { landmarkId: 'c', region: 'r', createdAt: NOW - 30 * DAY }] }, NOW);
    expect(t).toEqual({ 'r/a': 2, 'r/b': 1 });
  });

  it('computeAllSimilarity: one matrix per region with co-visited neighbors first', () => {
    const { regions } = computeAllSimilarity(dataset(), { now: NOW, landmarks });
    const row = regions.milan.neighbors.brera;
    expect(MILAN_IDS.slice(0, 4)).toContain(row[0][0]);
  });
});

describe('runWeekly', () => {
  let db;
  beforeEach(() => {
    db = fakeDb();
  });

  it('writes similarity, the NCF model, user embeddings, signals and status', async () => {
    const status = await runWeekly(db, { now: NOW, ds: dataset(), landmarks });
    expect(db.store.get('mapr_similarity').has('milan')).toBe(true);
    const ncf = db.store.get('mapr_models').get('ncf');
    expect(ncf.version).toBe(`v${NOW}`);
    expect(ncf.layers).toHaveLength(3);
    const user = db.store.get('mapr_user_models').get('u1');
    expect(user.byVersion[`v${NOW}`]).toHaveLength(32);
    expect(db.store.get('mapr_models').get('signals').trending).toBeTruthy();
    expect(status.ncf.action).toBe('promoted');
    expect(db.store.get('mapr_models').get('status').similarity.regions).toBeGreaterThan(0);
  }, 60_000);

  it('keeps the previous checkpoint when the new one is more than 5% worse', async () => {
    // A live model claiming an accuracy no new model can reach within 5%.
    db.store.set('mapr_models', new Map([['ncf', { version: 'v1', evaluation: { testAccuracy: 1.2 }, dim: 32, layers: [], items: {} }]]));
    const out = await runNcfWeekly(db, dataset(), { now: NOW });
    expect(out.action).toBe('kept-previous');
    expect(db.store.get('mapr_models').get('ncf').version).toBe('v1');
    expect(db.store.get('mapr_user_models')?.get('u1')).toBeUndefined();
  }, 60_000);

  it('rolls back to last week\'s checkpoint when the live model has drifted', async () => {
    const { createModel, serializeModel } = await import('../../src/lib/maprRank/ncf.js');
    const items = MILAN_IDS.map((id) => `milan/${id}`);
    const users = Array.from({ length: 16 }, (_, u) => `u${u}`);
    const { shared, users: emb } = serializeModel({ model: createModel({ numUsers: 16, numItems: items.length }), index: { users, items } });
    // Every place gets the same embedding, so the live model can't tell them
    // apart: accuracy on this week's visits drops to 0.
    const flat = { ...shared, items: Object.fromEntries(items.map((k) => [k, shared.items[items[0]]])) };
    db.store.set('mapr_models', new Map([
      ['ncf', { ...flat, version: 'vLive', evaluation: { testAccuracy: 1.2 } }],
      ['ncf_prev', { ...shared, version: 'vPrev', evaluation: { testAccuracy: 0.8 } }],
    ]));
    db.store.set('mapr_user_models', new Map(users.map((u) => [u, { byVersion: { vLive: emb[u] } }])));
    const out = await runNcfWeekly(db, dataset(), { now: NOW });
    expect(out.action).toBe('rolled-back');
    expect(out.liveAcc).toBe(0);
    expect(db.store.get('mapr_models').get('ncf')).toMatchObject({ version: 'vPrev', rolledBackFrom: 'vLive' });
  }, 60_000);

  it('skips training with no data', async () => {
    const out = await runNcfWeekly(db, { checkins: [], reviews: [] }, { now: NOW });
    expect(out).toMatchObject({ action: 'skipped', reason: 'not-enough-data' });
  });

  it('keeps the previous version of a user embedding for rollback', async () => {
    db.store.set('mapr_user_models', new Map([['u1', { byVersion: { v0: Array(32).fill(0) } }]]));
    await runNcfWeekly(db, dataset(), { now: NOW });
    expect(Object.keys(db.store.get('mapr_user_models').get('u1').byVersion).sort()).toEqual(['v0', `v${NOW}`]);
  }, 60_000);
});

describe('runDaily', () => {
  it('writes a totals-only report, posts to Slack and flags stagnation', async () => {
    const db = fakeDb({ mapr_user_models: { gone: { stagnating: true } } });
    const slack = vi.fn(async () => ({ posted: true }));
    const out = await runDaily(db, { now: NOW, ds: dataset(), slack });
    expect(out.date).toBe('2026-10-04');
    const report = db.store.get('mapr_metrics').get('2026-10-04');
    expect(report.totals.shown).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/"u1"/);
    expect(slack).toHaveBeenCalledOnce();
    expect(slack.mock.calls[0][0]).toContain('Mapr daily');
    expect(db.store.get('mapr_user_models').get('u1').stagnating).toBe(true);
    expect(db.store.get('mapr_user_models').get('gone').stagnating).toBe(false);
  });
});

describe('postToSlack', () => {
  it('needs a webhook URL', async () => {
    expect(await postToSlack('hi', { url: '' })).toMatchObject({ posted: false });
  });
  it('posts JSON text', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await postToSlack('hi', { url: 'https://hooks.example/x', fetchImpl })).toEqual({ posted: true, status: 200 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: 'hi' });
  });
  it('reports a network failure instead of throwing', async () => {
    expect(await postToSlack('hi', { url: 'https://x', fetchImpl: async () => { throw new Error('down'); } })).toMatchObject({ posted: false, reason: 'down' });
  });
});

it('liveAccuracy is null without a usable live model', () => {
  expect(liveAccuracy(null, {}, [])).toBeNull();
  expect(liveAccuracy({ layers: [], items: { a: [] } }, {}, [])).toBeNull();
});
