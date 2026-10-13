import { describe, it, expect, beforeEach } from 'vitest';
import { asksDistanceOrTime, asksHours, bestOrder, findInCatalog, placeHours, routeBetween } from './routeLookup.js';

const catalog = [
  { name: 'Kres Chophouse', lat: 28.5426, lng: -81.3797 },
  { name: 'Hillstone', lat: 25.77, lng: -80.19 },
];

beforeEach(() => {
  process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
  process.env.GOOGLE_PLACES_API_KEY = 'places-key';
});

describe('route lookup for Mapr chat', () => {
  it('spots distance and time questions', () => {
    expect(asksDistanceOrTime('how many minutes away from house of blues')).toBe(true);
    expect(asksDistanceOrTime('How far is Vizcaya?')).toBe(true);
    expect(asksDistanceOrTime('find me a steakhouse')).toBe(false);
  });

  it('finds catalog places by name', () => {
    expect(findInCatalog('kres chophouse', catalog)?.name).toBe('Kres Chophouse');
    expect(findInCatalog('xyz', catalog)).toBeNull();
  });

  it('returns the real route from Google: catalog place to a place found by search', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes('searchText')) return { ok: true, json: async () => ({ places: [{ displayName: { text: 'House of Blues Orlando' }, formattedAddress: '1490 E Buena Vista Dr', location: { latitude: 28.3711, longitude: -81.5168 } }] }) };
      return { ok: true, json: async () => ({ routes: [{ distanceMeters: 23500, duration: '1380s', staticDuration: '1200s' }] }) };
    };
    const r = await routeBetween({ from: 'Kres Chophouse', to: 'House of Blues Orlando' }, { catalog, fetchImpl });
    expect(r).toMatchObject({ from: { name: 'Kres Chophouse' }, to: { name: 'House of Blues Orlando' }, mode: 'driving', miles: 14.6, minutes: 23, minutesWithoutTraffic: 20, source: 'Google Maps' });
    expect(calls.find((c) => c.url.includes('computeRoutes')).body.destination.location.latLng.latitude).toBe(28.3711);
  });

  it('says so instead of guessing when a place or the route cannot be found', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ places: [] }) });
    expect(await routeBetween({ from: 'Kres Chophouse', to: 'Nowhere Land' }, { catalog, fetchImpl })).toEqual({ error: 'Couldn\'t find "Nowhere Land".' });
    expect(await routeBetween({ from: 'my location', to: 'Hillstone' }, { catalog, fetchImpl })).toEqual({ error: "The traveler's location isn't available." });
  });
});

describe('travel and hours questions', () => {
  it('catches typos and skips time questions that are not about travel', () => {
    for (const q of ['hw long is the drive from Kres to Hillstone', 'is Vizcaya far', 'can i walk to Hillstone', 'whats the commute to Hillstone', 'Kres to Hillstone how long']) {
      expect(asksDistanceOrTime(q), q).toBe(true);
    }
    for (const q of ['how long does it take to set up a trip', 'i have 2 hours to kill, ideas?', 'how long should i spend at Vizcaya', 'is there a park nearby']) {
      expect(asksDistanceOrTime(q), q).toBe(false);
    }
  });

  it('spots hours questions', () => {
    expect(asksHours('is Hillstone open right now')).toBe(true);
    expect(asksHours('what time does Hillstone close')).toBe(true);
    expect(asksHours('i have 2 hours to kill')).toBe(false);
    expect(asksHours("i'm open to anything")).toBe(false);
  });
});

describe('place_hours', () => {
  it("reads open-now, closing time and today's hours in the place's own time", async () => {
    const now = Date.UTC(2026, 9, 14, 18, 0); // Wed 2 PM in Miami (UTC-4)
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        places: [
          {
            displayName: { text: 'Hillstone' },
            formattedAddress: '201 Miracle Mile',
            utcOffsetMinutes: -240,
            businessStatus: 'OPERATIONAL',
            currentOpeningHours: {
              openNow: true,
              nextCloseTime: '2026-10-15T02:00:00Z',
              weekdayDescriptions: ['Monday: 11 AM – 10 PM', 'Tuesday: 11 AM – 10 PM', 'Wednesday: 11 AM – 10 PM', 'Thursday: x', 'Friday: x', 'Saturday: x', 'Sunday: x'],
            },
          },
        ],
      }),
    });
    expect(await placeHours({ place: 'Hillstone' }, { fetchImpl, now })).toMatchObject({ name: 'Hillstone', openNow: true, closesAt: '10:00 PM', today: 'Wednesday: 11 AM – 10 PM', source: 'Google Maps' });
  });

  it('says so for a closed-for-good place, and errors without a key', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ places: [{ displayName: { text: 'Old Spot' }, businessStatus: 'CLOSED_PERMANENTLY' }] }) });
    expect(await placeHours({ place: 'Old Spot' }, { fetchImpl })).toMatchObject({ permanentlyClosed: true });
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(await placeHours({ place: 'Old Spot' }, { fetchImpl })).toHaveProperty('error');
  });
});

describe('best_order', () => {
  it('tries every order and returns the fastest, with real legs and a total', async () => {
    // A straight line: start 0, stops at 3, 1 and 2 (minutes = distance).
    const pts = { 'my location': 0, C: 3, A: 1, B: 2 };
    const cat = Object.entries(pts).filter(([n]) => n !== 'my location').map(([name, x]) => ({ name: `Stop ${name}`, lat: 0, lng: x / 100 }));
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      const xs = body.origins.map((o) => o.waypoint.location.latLng.longitude * 100);
      const out = [];
      xs.forEach((a, i) => xs.forEach((b, j) => out.push({ originIndex: i, destinationIndex: j, distanceMeters: Math.abs(a - b) * 1609.34, duration: `${Math.abs(a - b) * 60}s`, condition: 'ROUTE_EXISTS' })));
      return { ok: true, json: async () => out };
    };
    const r = await bestOrder({ stops: ['Stop C', 'Stop A', 'Stop B'], start: 'my location' }, { catalog: cat, near: { lat: 0, lng: 0 }, fetchImpl });
    expect(r.order).toEqual(['Stop A', 'Stop B', 'Stop C']);
    expect(r.totalMinutes).toBe(3);
    expect(r.legs).toHaveLength(3);
    expect(r.source).toBe('Google Maps');
  });

  it('needs two stops and names the ones it cannot find', async () => {
    expect(await bestOrder({ stops: ['Hillstone'] }, { catalog })).toHaveProperty('error');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ places: [] }) });
    expect((await bestOrder({ stops: ['Hillstone', 'Nowhere Cafe'], start: '' }, { catalog, fetchImpl })).error).toMatch(/Nowhere Cafe/);
  });
});
