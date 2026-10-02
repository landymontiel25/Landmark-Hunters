import { describe, it, expect, vi, beforeEach } from 'vitest';

let store;
let usage;
const docOf = (col, id) => ({
  get: async () => {
    const m = col === 'place_ids' ? store : usage;
    return { exists: m.has(id), data: () => m.get(id) };
  },
  set: async (data, opts) => {
    if (col === 'place_ids') store.set(id, data);
    else usage.set(id, { ...(opts?.merge ? usage.get(id) : {}), ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v && v.__inc != null ? (usage.get(id)?.[k] || 0) + v.__inc : v])) });
  },
  delete: async () => store.delete(id),
});
const fakeDb = { collection: (col) => ({ doc: (id) => docOf(col, id) }) };
vi.mock('./firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => 'ts' } }));

const { runPhotoBackfill, quotaDay } = await import('./photoBackfill.js');

const lm = (n, over = {}) => ({ id: `l${n}`, regionId: 'r', name: `Place ${n}`, lat: 1, lng: 2, ...over });
const LANDMARKS = Array.from({ length: 10 }, (_, i) => lm(i));
const hit = (id) => async () => ({ match: { id, displayName: { text: 'Place' }, photos: [{ name: 'p' }] } });
const run = (landmarks, search, opts = {}) => runPhotoBackfill(fakeDb, landmarks, { apiKey: 'k', search, ...opts });

beforeEach(() => {
  store = new Map();
  usage = new Map();
});

describe('photo backfill', () => {
  it('saves a place ID for a match and a no-match marker, and never touches an image', async () => {
    const search = vi.fn(async (name) => (name === 'Place 1' ? { match: null } : { match: { id: 'ChIJ1', displayName: { text: name }, photos: [{ name: 'places/x/photos/y' }] } }));
    const r = await run(LANDMARKS.slice(0, 2), search);
    expect(r).toMatchObject({ total: 2, remaining: 0, done: true, saved: { ok: 1, noMatch: 1 }, stopped: null });
    expect(store.get('r__l0')).toMatchObject({ status: 'ok', placeId: 'ChIJ1' });
    expect(store.get('r__l1')).toMatchObject({ status: 'no-match', placeId: null });
    expect(JSON.stringify([...store.values()])).not.toContain('photos/y'); // no photo name stored
  });

  it('skips landmarks that already have a photo, a saved place ID, or a fresh no-match', async () => {
    store.set('r__l1', { status: 'ok', placeId: 'ChIJ', matchedName: 'x', lat: 1, lng: 2 });
    store.set('r__l2', { status: 'no-match', placeId: null, verifiedAt: Date.now() - 1000 });
    store.set('r__l3', { status: 'no-match', placeId: null, verifiedAt: Date.now() - 40 * 86400000 }); // stale: searched again
    const search = vi.fn(hit('ChIJn'));
    const lms = [lm(0, { images: ['x.jpg'] }), lm(1), lm(2), lm(3), lm(4)];
    const r = await run(lms, search);
    expect(search.mock.calls.map((c) => c[0])).toEqual(['Place 3', 'Place 4']);
    expect(r.total).toBe(4);
  });

  it('does one batch per call, then resumes where it left off', async () => {
    const search = vi.fn(hit('ChIJ'));
    const a = await run(LANDMARKS, search, { batchSize: 4 });
    expect(a).toMatchObject({ remaining: 6, done: false, thisCall: { matched: 4, searched: 4 } });
    const b = await run(LANDMARKS, search, { batchSize: 4 });
    expect(b.remaining).toBe(2);
    const c = await run(LANDMARKS, search, { batchSize: 4 });
    expect(c).toMatchObject({ remaining: 0, done: true, saved: { ok: 10, noMatch: 0 } });
    expect(search).toHaveBeenCalledTimes(10);
  });

  it('stops at the daily limit and counts searches across calls', async () => {
    const search = vi.fn(hit('ChIJ'));
    const a = await run(LANDMARKS, search, { batchSize: 4, dailyLimit: 6 });
    expect(a).toMatchObject({ searchesToday: 4, stopped: null });
    const b = await run(LANDMARKS, search, { batchSize: 4, dailyLimit: 6 });
    expect(b).toMatchObject({ searchesToday: 6, stopped: 'daily-limit', remaining: 4 });
    const c = await run(LANDMARKS, search, { batchSize: 4, dailyLimit: 6 });
    expect(c.thisCall.searched).toBe(0);
    expect(c.stopped).toBe('daily-limit');
    expect(search).toHaveBeenCalledTimes(6);
  });

  it('does not save a failed search, so it is retried, and stops at once on a Google quota or denied error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const search = vi.fn(async () => (++n === 1 ? { error: true, status: 500 } : { error: true, status: 429 }));
    const r = await run(LANDMARKS, search);
    expect(r).toMatchObject({ stopped: 'google-quota', thisCall: { failed: 2 }, remaining: 10 });
    expect(store.size).toBe(0);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('search failed (backfill: Google status 429)'))).toBe(true);
    warn.mockRestore();
    const denied = await run(LANDMARKS, async () => ({ error: true, status: 403 }));
    expect(denied.stopped).toBe('google-denied');
  });

  it('stops after three failed searches in a row, and a thrown error counts as one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    });
    const r = await run(LANDMARKS, search);
    expect(r).toMatchObject({ stopped: 'failing', thisCall: { failed: 3, searched: 3 } });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('timeout failed'))).toBe(true);
    warn.mockRestore();
  });

  it('counts landmarks without coordinates separately and never searches them', async () => {
    const search = vi.fn(hit('ChIJ'));
    const r = await run([lm(0), lm(1, { lat: undefined })], search);
    expect(r).toMatchObject({ total: 1, withoutCoordinates: 1 });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('counts the day by Pacific time (Google quotas reset at midnight Pacific)', () => {
    expect(quotaDay(Date.parse('2026-10-02T06:30:00Z'))).toBe('2026-10-01'); // 11:30 pm Oct 1 in LA
    expect(quotaDay(Date.parse('2026-10-02T08:30:00Z'))).toBe('2026-10-02');
  });
});
