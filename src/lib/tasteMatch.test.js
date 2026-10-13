import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ doc: null, reads: 0 }));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  getDoc: vi.fn(async () => {
    store.reads++;
    return { exists: () => !!store.doc, data: () => store.doc };
  }),
}));

const { tasteMatchFor, _resetTasteMatch } = await import('./tasteMatch.js');

beforeEach(() => {
  _resetTasteMatch();
  store.reads = 0;
  store.doc = { global: [{ uid: 'hi', score: 0.72 }, { uid: 'some', score: 0.4 }, { uid: 'weak', score: 0.1 }], byRegion: { philly: [{ uid: 'some', score: 0.65 }] } };
});

describe('tasteMatchFor', () => {
  it('gives High, Some or null from your own neighbors doc, city list first', async () => {
    expect(await tasteMatchFor('me', 'hi')).toBe('High');
    expect(await tasteMatchFor('me', 'some')).toBe('Some');
    expect(await tasteMatchFor('me', 'some', 'philly')).toBe('High');
    expect(await tasteMatchFor('me', 'weak')).toBeNull();
    expect(await tasteMatchFor('me', 'stranger')).toBeNull();
    expect(await tasteMatchFor('me', 'me')).toBeNull();
    expect(store.reads).toBe(1);
  });
  it('no doc means no label', async () => {
    store.doc = null;
    expect(await tasteMatchFor('me', 'hi')).toBeNull();
  });
});
