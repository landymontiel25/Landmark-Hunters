import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchJson = vi.fn(async () => ({ mode: 'X', points: [[0, 0], [1, 1]], steps: [] }));
vi.mock('./friendlyError', async (orig) => ({ ...(await orig()), fetchJson: (...a) => fetchJson(...a) }));
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({}) }));
const findBoatRoute = vi.fn();
vi.mock('./boatRoute', async (orig) => ({ ...(await orig()), findBoatRoute: (...a) => findBoatRoute(...a) }));
const { routeFor } = await import('./routing.js');

const A = { lat: 26.54, lng: -76.96 };
const B = { lat: 26.5, lng: -76.99 };
beforeEach(() => {
  fetchJson.mockClear();
  findBoatRoute.mockReset();
});

describe('routeFor: the picked mode is never dropped (owner, 2026-11-23)', () => {
  it('walk, car, bike and bus each reach the road route service in that mode', async () => {
    for (const [mode, api] of [['walk', 'WALK'], ['car', 'DRIVE'], ['bike', 'BICYCLE'], ['bus', 'TRANSIT']]) {
      fetchJson.mockClear();
      await routeFor(A, B, mode);
      expect(JSON.parse(fetchJson.mock.calls[0][1].body).mode).toBe(api);
    }
  });
  it('Boat never calls the road route service: a route around the islands', async () => {
    findBoatRoute.mockResolvedValue({ points: [[A.lat, A.lng], [26.52, -76.98], [B.lat, B.lng]], distanceMeters: 6000, minutes: 16 });
    const data = await routeFor(A, B, 'boat');
    expect(fetchJson).not.toHaveBeenCalled();
    expect(data.mode).toBe('BOAT');
    expect(data.distanceMeters).toBe(6000);
    expect(data.durationSeconds).toBe(16 * 60);
    expect(data.steps.length).toBeGreaterThan(0);
  });
  it('no boat route is a plain message, never a car route or a server error', async () => {
    findBoatRoute.mockResolvedValue(null);
    await expect(routeFor(A, B, 'boat')).rejects.toMatchObject({ noBoatRoute: true });
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
