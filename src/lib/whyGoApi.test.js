// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

let signedIn = true;
vi.mock('./apiAuth', () => ({ authHeaders: async () => (signedIn ? { Authorization: 'Bearer t' } : {}) }));
vi.mock('./apiBase', () => ({ API_BASE: 'https://api.example' }));

const lines = ["I'd go early.", "You'll see why.", "It's an easy stop."];
const reply = (stops) => ({ ok: true, json: async () => ({ why: Object.fromEntries(stops.map((s) => [`${s.region}/${s.id}`, lines])) }) });

beforeEach(async () => {
  localStorage.clear();
  signedIn = true;
  (await import('./whyGoApi'))._resetWhyGo();
});

describe('loadWhyGo', () => {
  it('asks once for the whole trip, then answers from the cache', async () => {
    const { loadWhyGo } = await import('./whyGoApi');
    const fetchImpl = vi.fn(async (url, init) => reply(JSON.parse(init.body).stops));
    const trip = [{ region: 'miami', id: 'a' }, { region: 'miami', id: 'b' }, { external: true, id: 'web-1', name: 'Found' }];
    const first = await loadWhyGo(trip, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example/api/why-go');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).stops).toEqual([{ region: 'miami', id: 'a' }, { region: 'miami', id: 'b' }]);
    expect(first).toEqual({ 'miami/a': lines, 'miami/b': lines });
    (await import('./whyGoApi'))._resetWhyGo();
    expect(await loadWhyGo(trip, { fetchImpl })).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('asks nothing when signed out, and is empty on a failure', async () => {
    const { loadWhyGo } = await import('./whyGoApi');
    signedIn = false;
    const fetchImpl = vi.fn();
    expect(await loadWhyGo([{ region: 'miami', id: 'a' }], { fetchImpl })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
    signedIn = true;
    expect(await loadWhyGo([{ region: 'miami', id: 'a' }], { fetchImpl: async () => ({ ok: false }) })).toEqual({});
  });
});
