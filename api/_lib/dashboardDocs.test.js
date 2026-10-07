import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));

const { writeDashboardModels } = await import('./dashboardDocs.js');

function fakeDb() {
  const sets = [];
  return {
    sets,
    collection: (col) => ({ doc: (id) => ({ col, id }) }),
    batch: () => ({ set: (ref, data, opts) => sets.push({ ...ref, data, opts }), commit: async () => {} }),
  };
}

describe('writeDashboardModels', () => {
  it('only writes last_trained when the NCF model was promoted (merge keeps the real date otherwise)', async () => {
    const kept = fakeDb();
    await writeDashboardModels(kept, { ncf: { action: 'kept' }, similarity: {} }, { now: 1000 });
    const keptDoc = kept.sets.find((s) => s.col === 'mapr_ncf_model').data;
    expect('last_trained' in keptDoc).toBe(false);
    expect(keptDoc.last_run).toBe(1000);

    const promoted = fakeDb();
    await writeDashboardModels(promoted, { ncf: { action: 'promoted' }, similarity: {} }, { now: 2000 });
    expect(promoted.sets.find((s) => s.col === 'mapr_ncf_model').data.last_trained).toBe(2000);
  });
});
