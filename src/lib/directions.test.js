import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/directions.js';

// Quotas fail closed with no Firestore; these tests are about directions.
vi.mock('../../api/_lib/usageQuota.js', async (orig) => ({ ...(await orig()), takeDailyQuota: async () => ({ ok: true }) }));

const run = (body) =>
  new Promise((resolve) => {
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json(data) {
        resolve({ code: this.code, data });
      },
    };
    handler({ method: 'POST', body, headers: {}, socket: {} }, res);
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('api/directions', () => {
  it('decodes the route, strips step HTML and reports traffic vs no-traffic time', async () => {
    vi.stubEnv('GOOGLE_ROUTES_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          {
            duration: '2143s',
            staticDuration: '1374s',
            distanceMeters: 10634,
            // Google's documented sample polyline.
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
            legs: [
              {
                steps: [
                  {
                    navigationInstruction: { instructions: 'Turn <b>right</b> onto Washington Ave\nPass by Publix', maneuver: 'TURN_RIGHT' },
                    distanceMeters: 1404,
                    staticDuration: '250s',
                    endLocation: { latLng: { latitude: 40.7, longitude: -120.95 } },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { code, data } = await run({ origin: { lat: 25.79, lng: -80.13 }, destination: { lat: 25.8, lng: -80.2 } });
    expect(code).toBe(200);
    expect(data.mode).toBe('DRIVE');
    expect(data.durationSeconds).toBe(2143);
    expect(data.staticDurationSeconds).toBe(1374);
    expect(data.points).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(data.steps).toEqual([
      {
        instruction: 'Turn right onto Washington Ave · Pass by Publix',
        distanceMeters: 1404,
        durationSeconds: 250,
        end: [40.7, -120.95],
        maneuver: 'TURN_RIGHT',
      },
    ]);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.routingPreference).toBe('TRAFFIC_AWARE');
  });

  it('walks short legs, with no traffic routing', async () => {
    vi.stubEnv('GOOGLE_ROUTES_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ duration: '600s', distanceMeters: 800, polyline: { encodedPolyline: '_p~iF~ps|U' }, legs: [] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { data } = await run({ origin: { lat: 25.79, lng: -80.13 }, destination: { lat: 25.793, lng: -80.139 } });
    expect(data.mode).toBe('WALK');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.travelMode).toBe('WALK');
    expect(sent.routingPreference).toBeUndefined();
  });

  it('rejects bad input and a missing key', async () => {
    vi.stubEnv('GOOGLE_ROUTES_API_KEY', 'test-key');
    expect((await run('{not json')).code).toBe(400);
    expect((await run({ origin: { lat: 'x' } })).code).toBe(400);
    vi.stubEnv('GOOGLE_ROUTES_API_KEY', '');
    expect((await run({ origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 } })).code).toBe(503);
  });
});
