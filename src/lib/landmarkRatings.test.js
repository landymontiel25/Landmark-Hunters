import { describe, it, expect, vi, beforeEach } from 'vitest';

let headers = { Authorization: 'Bearer t' };
vi.mock('./apiAuth', () => ({ authHeaders: async () => headers }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));

const { loadLandmarkRatings, _resetLandmarkRatings } = await import('./landmarkRatings');
const lm = { id: 'liberty-bell-center', regionId: 'philly' };
const ok = (sources) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sources }) }));

beforeEach(() => {
  headers = { Authorization: 'Bearer t' };
  _resetLandmarkRatings();
});

describe('loadLandmarkRatings', () => {
  it('shares one request between two rows for the same landmark', async () => {
    const fetchImpl = ok({ google: { rating: 4 } });
    const [a, b] = await Promise.all([loadLandmarkRatings(lm, { fetchImpl }), loadLandmarkRatings(lm, { fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/landmark-ratings?region=philly&id=liberty-bell-center');
  });
  it('remembers a real answer in memory for the session, so each place costs one lookup (owner, 2026-11-08)', async () => {
    const fetchImpl = ok({ google: { rating: 4.5, count: 10 } });
    await loadLandmarkRatings(lm, { fetchImpl });
    const again = await loadLandmarkRatings(lm, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again.google.rating).toBe(4.5);
  });
  it('asks again when the last answer had no Google data (a failure is not remembered)', async () => {
    const fetchImpl = ok({ google: null });
    await loadLandmarkRatings(lm, { fetchImpl });
    await loadLandmarkRatings(lm, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('signed out, a server error or a network error all resolve to no data', async () => {
    headers = {};
    const fetchImpl = ok({ google: { rating: 4 } });
    expect(await loadLandmarkRatings(lm, { fetchImpl })).toEqual({ google: null, googleNoRating: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    headers = { Authorization: 'Bearer t' };
    expect(await loadLandmarkRatings(lm, { fetchImpl: vi.fn(async () => ({ ok: false, status: 500 })) })).toEqual({ google: null, googleNoRating: false });
    expect(await loadLandmarkRatings(lm, { detail: true, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toEqual({ google: null, googleNoRating: false });
  });
});
