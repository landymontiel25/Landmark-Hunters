import { describe, it, expect, vi } from 'vitest';

vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));
vi.mock('./apiBase', () => ({ API_BASE: 'https://api.example' }));

import { fetchPickReasons } from './pickReasonsApi';

const picks = [
  { region: 'villanova', id: 'a', pickType: 'usual' },
  { region: 'villanova', id: 'b', pickType: 'new', chain: { from: 'food', to: 'art-museums', count: 3 } },
];

describe('fetchPickReasons', () => {
  it('makes one call for the whole set through API_BASE', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ reasons: { 'villanova/a': 'Nice.', 'other/x': 'no' } }) }));
    expect(await fetchPickReasons(picks, { fetchImpl })).toEqual({ 'villanova/a': 'Nice.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example/api/pick-reasons');
    expect(JSON.parse(init.body).picks).toEqual([
      { region: 'villanova', id: 'a', pickType: 'usual', chainFrom: null },
      { region: 'villanova', id: 'b', pickType: 'new', chainFrom: 'food' },
    ]);
  });

  it('resolves to no reasons (so cards use the fallback line) on an error, a bad status, or a timeout', async () => {
    expect(await fetchPickReasons(picks, { fetchImpl: async () => Promise.reject(new Error('offline')) })).toEqual({});
    expect(await fetchPickReasons(picks, { fetchImpl: async () => ({ ok: false, status: 500 }) })).toEqual({});
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await fetchPickReasons(picks, { fetchImpl: hang, timeoutMs: 20 })).toEqual({});
  });

  it('makes no call for an empty set', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchPickReasons([], { fetchImpl })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
