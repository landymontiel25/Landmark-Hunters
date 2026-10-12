import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/geolocation', () => ({ Geolocation: { getCurrentPosition: vi.fn() } }));
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));

const { verifyCheckinPresence } = await import('./verifyPresence');

const pos = { coords: { latitude: 39.95, longitude: -75.15, accuracy: 12 }, timestamp: 1234 };
const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

describe('verifyCheckinPresence', () => {
  it('sends a fresh fix with its timestamp and returns the server answer', async () => {
    const fetchImpl = ok({ ok: true, verified: true, reason: null });
    const out = await verifyCheckinPresence('me_lm', { fetchImpl, getPosition: async () => pos });
    expect(out).toMatchObject({ verified: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/verify-checkin');
    expect(JSON.parse(init.body)).toEqual({ checkinId: 'me_lm', fix: { lat: 39.95, lng: -75.15, accuracy: 12, timestamp: 1234 } });
    expect(init.headers.Authorization).toBe('Bearer t');
  });
  it('resolves null (never throws) when location or the server fails', async () => {
    expect(await verifyCheckinPresence('me_lm', { fetchImpl: ok({}), getPosition: async () => { throw new Error('denied'); } })).toBe(null);
    expect(await verifyCheckinPresence('me_lm', { fetchImpl: vi.fn(async () => ({ ok: false })), getPosition: async () => pos })).toBe(null);
    expect(await verifyCheckinPresence('me_lm', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }), getPosition: async () => pos })).toBe(null);
    expect(await verifyCheckinPresence(null)).toBe(null);
  });
});
