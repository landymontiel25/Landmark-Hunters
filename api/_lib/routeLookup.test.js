import { describe, it, expect, beforeEach } from 'vitest';
import { asksDistanceOrTime, findInCatalog, routeBetween } from './routeLookup.js';

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
