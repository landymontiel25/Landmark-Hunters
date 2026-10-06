// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../firebase', () => ({ db: null }));
const { loadMaprModels, _resetModelMemory } = await import('./modelStore.js');
const { readSeen, recordSeen, clearSeen } = await import('./seenHistory.js');

const NOW = Date.parse('2026-10-01T00:00:00Z');
const docs = {
  'mapr_models/ncf': { dim: 2, layers: [{ in: 4, out: 1, W: [1, 1, 1, 1], b: [0] }, { in: 1, out: 1, W: [1], b: [0] }], items: { 'milan/a': [1, 0] }, version: 'v2' },
  'mapr_models/signals': { trending: { 'milan/a': 3 } },
  'mapr_user_models/u1': { byVersion: { v1: [0, 0], v2: [0.5, 0.5] }, stagnating: true },
  'mapr_similarity/milan': { neighbors: JSON.stringify({ a: [['b', 0.5]] }) },
};

beforeEach(() => {
  localStorage.clear();
  _resetModelMemory();
});

describe('loadMaprModels', () => {
  it('loads every model doc and picks the embedding for the live version', async () => {
    const read = vi.fn(async ([c, id]) => docs[`${c}/${id}`] ?? null);
    const m = await loadMaprModels({ uid: 'u1', regions: ['milan', 'madrid'], nowMs: NOW, read });
    expect(m.userEmbedding).toEqual([0.5, 0.5]);
    expect(m.similarity).toEqual({ milan: { a: [['b', 0.5]] } });
    expect(m.signals.trending['milan/a']).toBe(3);
    expect(m.serverStagnating).toBe(true);
    expect(m.ncf.active).toBe(false); // the doc has no `active`: off
  });

  it('caches on the device for 12 hours', async () => {
    const read = vi.fn(async ([c, id]) => docs[`${c}/${id}`] ?? null);
    await loadMaprModels({ uid: 'u1', regions: ['milan'], nowMs: NOW, read });
    const calls = read.mock.calls.length;
    _resetModelMemory(); // memory gone, localStorage kept
    await loadMaprModels({ uid: 'u1', regions: ['milan'], nowMs: NOW + 3600000, read });
    expect(read.mock.calls.length).toBe(calls);
    await loadMaprModels({ uid: 'u1', regions: ['milan'], nowMs: NOW + 13 * 3600000, read });
    expect(read.mock.calls.length).toBe(calls * 2);
  });

  it('turns failures and version mismatches into nulls (ranking falls back)', async () => {
    const read = async ([c, id]) => {
      if (c === 'mapr_similarity') throw new Error('offline');
      return { ...docs, 'mapr_user_models/u1': { byVersion: { v1: [0, 0] } } }[`${c}/${id}`] ?? null;
    };
    const m = await loadMaprModels({ uid: 'u1', regions: ['milan'], nowMs: NOW, read });
    expect(m.userEmbedding).toBeNull();
    expect(m.similarity).toEqual({});
  });

  it('needs a signed-in user', async () => {
    expect(await loadMaprModels({ uid: null })).toBeNull();
  });
});

describe('seenHistory', () => {
  it('counts showings per place, newest kept', () => {
    recordSeen('u', [{ id: 'a' }, { id: 'b' }], 1000);
    recordSeen('u', [{ id: 'a' }], 2000);
    expect(readSeen('u')).toEqual({ a: { count: 2, firstShownAt: 1000, lastShownAt: 2000 }, b: { count: 1, firstShownAt: 1000, lastShownAt: 1000 } });
    recordSeen('u', [{ id: 'c' }], 3000, localStorage, 2);
    expect(Object.keys(readSeen('u')).sort()).toEqual(['a', 'c']);
    clearSeen('u');
    expect(readSeen('u')).toEqual({});
  });

  it('survives broken storage', () => {
    localStorage.setItem('lh-mapr-seen:v1:x', '{bad');
    expect(readSeen('x')).toEqual({});
    expect(readSeen(null)).toEqual({});
  });
});
