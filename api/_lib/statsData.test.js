import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));
const { readAll, loadStatsData } = await import('./statsData.js');

function fakeQuery(total) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `d${i}` }));
  const calls = [];
  const make = (st) => ({
    orderBy: () => make(st),
    limit: (n) => make({ ...st, n }),
    startAfter: (doc) => make({ ...st, after: doc }),
    get: async () => {
      const from = st.after ? all.indexOf(st.after) + 1 : 0;
      calls.push(st.n);
      return { docs: all.slice(from, from + st.n) };
    },
  });
  return { q: make({}), calls };
}

describe('readAll (bounded batches)', () => {
  it('reads everything in pages of the given size', async () => {
    const { q, calls } = fakeQuery(23);
    const { rows, truncated } = await readAll(q, (d) => d.id, { pageSize: 10, maxDocs: 1000 });
    expect(rows).toHaveLength(23);
    expect(truncated).toBe(false);
    expect(calls).toEqual([10, 10, 10]);
  });
  it('stops at the maximum and says it was cut off', async () => {
    const { q } = fakeQuery(100);
    const { rows, truncated } = await readAll(q, (d) => d.id, { pageSize: 10, maxDocs: 30 });
    expect(rows).toHaveLength(30);
    expect(truncated).toBe(true);
  });
});

describe('loadStatsData', () => {
  it('keeps the NCF model on telemetry rows (metrics reads it for the v2 share)', async () => {
    const docsFor = (name) =>
      name === 'recommendation_log' ? [{ id: 'r1', data: () => ({ userId: 'u1', telemetry: true, ncfModel: 'v2', ncfScore: 0.5 }) }] : [];
    const query = (docs) => ({ orderBy: () => query(docs), limit: () => query(docs), startAfter: () => query([]), get: async () => ({ docs }) });
    const db = { collection: (n) => query(docsFor(n)), collectionGroup: (n) => query(docsFor(n)) };
    const { recommendationLog } = await loadStatsData(db);
    expect(recommendationLog[0].ncfModel).toBe('v2');
  });
});
