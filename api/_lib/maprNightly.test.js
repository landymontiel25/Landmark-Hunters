import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' }, FieldPath: { documentId: () => '__id__' } }));

const { computeAllSimilarity, liveAccuracy, maprV2Enabled, ncfActiveUsers, ncfPositives, postToSlack, pruneVersions, runDaily, runNcfWeekly, runWeekly, trendingCounts, versionFor } = await import('./maprNightly.js');
const { NCF, NCF_V2 } = await import('../../src/lib/maprRank/config.js');

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

  it('turns NCF on only above the threshold (10 here), and back off below', async () => {
    const cfg = { ...NCF, autoEnableAboveUsers: 10 };
    const ds = dataset(); // 16 users with check-ins
    let out = await runNcfWeekly(db, ds, { now: NOW, cfg });
    expect(out).toMatchObject({ active: true, activeUsers: 16, activeThreshold: 10 });
    expect(db.store.get('mapr_models').get('ncf')).toMatchObject({ active: true, activeUsers: 16 });
    const few = { ...ds, checkins: ds.checkins.filter((c) => ['u0', 'u1'].includes(c.userId)), reviews: [] };
    out = await runNcfWeekly(db, few, { now: NOW + 7 * DAY, cfg });
    expect(out).toMatchObject({ active: false, activeUsers: 2 });
    expect(db.store.get('mapr_models').get('ncf').active).toBe(false);
  }, 60_000);

  it('counts active users over the 90-day window, exactly 10 is still off', async () => {
    const pos = Array.from({ length: 10 }, (_, u) => ({ userId: `u${u}`, itemKey: 'r/x', at: NOW - DAY }));
    expect(ncfActiveUsers([...pos, { userId: 'old', itemKey: 'r/x', at: NOW - 100 * DAY }], { now: NOW })).toBe(10);
    const out = await runNcfWeekly(db, { checkins: pos.map((p) => ({ userId: p.userId, landmarkId: 'x', region: 'r', createdAt: p.at })), reviews: [] }, { now: NOW, cfg: { ...NCF, autoEnableAboveUsers: 10 } });
    expect(out.active).toBe(false);
  }, 60_000);

  it('while testing (threshold 0), one active user turns NCF on, none keeps it off', async () => {
    expect(NCF.autoEnableAboveUsers).toBe(0);
    const one = { checkins: [{ userId: 'me', landmarkId: 'x', region: 'r', createdAt: NOW - DAY }], reviews: [] };
    expect((await runNcfWeekly(db, one, { now: NOW })).active).toBe(true);
    expect((await runNcfWeekly(db, { checkins: [], reviews: [] }, { now: NOW })).active).toBe(false);
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

describe('Mapr v2 weekly training', () => {
  it('trains v2 next to v1 into its own docs, and both embeddings live side by side', async () => {
    const db = fakeDb();
    const status = await runWeekly(db, { now: NOW, ds: dataset(), landmarks });
    const v2 = db.store.get('mapr_models').get('ncf_v2');
    expect(v2).toMatchObject({ version: `v2-${NOW}`, family: 'v2' });
    expect(v2.evaluation).toMatchObject({ family: 'v2', earlyStoppingOn: 'accuracy' });
    expect(db.store.get('mapr_models').get('ncf')).toMatchObject({ version: `v${NOW}`, family: 'v1' });
    const user = db.store.get('mapr_user_models').get('u1');
    expect(user.byVersion[`v${NOW}`]).toHaveLength(32);
    expect(user.byVersion[`v2-${NOW}`]).toHaveLength(32);
    expect(status.ncfV2).toMatchObject({ action: 'promoted', family: 'v2' });
    const dash = db.store.get('mapr_ncf_model').get('current');
    expect(dash.v2).toMatchObject({ last_action: 'promoted', model_version: `v2-${NOW}`, last_trained: NOW });
    expect(dash.v2.test_accuracy_region).toBeGreaterThan(0);
    expect(dash.test_accuracy_catalog).toBeGreaterThan(0);
  }, 120_000);

  it('keeps v2 promotion and rollback separate from v1', async () => {
    const db = fakeDb({ mapr_models: { ncf_v2: { version: 'v2-1', family: 'v2', evaluation: { testAccuracy: 1.2 }, dim: 32, layers: [], items: {} } } });
    const out = await runNcfWeekly(db, dataset(), { now: NOW, cfg: NCF_V2 });
    expect(out.action).toBe('kept-previous');
    expect(db.store.get('mapr_models').get('ncf_v2').version).toBe('v2-1');
    expect(db.store.get('mapr_models').has('ncf')).toBe(false);
  }, 60_000);

  it('prunes each family on its own', () => {
    const prior = { v100: [1], v200: [2], v300: [3], 'v2-100': [4], 'v2-200': [5] };
    expect(Object.keys(pruneVersions(prior, 'v400', 2)).sort()).toEqual(['v2-100', 'v2-200', 'v300']);
    expect(Object.keys(pruneVersions(prior, 'v2-300', 2)).sort()).toEqual(['v100', 'v2-200', 'v200', 'v300']);
    expect(versionFor(NCF, 5)).toBe('v5');
    expect(versionFor(NCF_V2, 5)).toBe('v2-5');
  });

  it('trains v2 only while the rollout is on', () => {
    expect(maprV2Enabled({ maprV2: { enabled: true, rollout: 20 } })).toBe(true);
    expect(maprV2Enabled({ maprV2: { enabled: false, rollout: 20 } })).toBe(false);
    expect(maprV2Enabled({ maprV2: { enabled: true, rollout: 0 } })).toBe(false);
    expect(maprV2Enabled({})).toBe(false);
  });
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
  it('gives up on a webhook that never answers', async () => {
    const fetchImpl = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    expect(await postToSlack('hi', { url: 'https://x', fetchImpl, timeoutMs: 20 })).toMatchObject({ posted: false });
  });
});

it('liveAccuracy is null without a usable live model', () => {
  expect(liveAccuracy(null, {}, [])).toBeNull();
  expect(liveAccuracy({ layers: [], items: { a: [] } }, {}, [])).toBeNull();
});
