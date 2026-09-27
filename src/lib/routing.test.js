import { describe, it, expect } from 'vitest';
import { SORT_OPTIONS, orderStops, annotateRoute, estimateTravelMinutes } from './routing';

// Origin at (0,0); stops laid out on a line so straight-line distances are
// unambiguous: A is 1km away, B 2km, C 3km, D 4km.
const origin = { lat: 0, lng: 0 };
const km = 1 / 111.32; // ~1km of latitude
const A = { id: 'a', name: 'A', lat: 1 * km, lng: 0, typicalMinutes: 60, free: false };
const B = { id: 'b', name: 'B', lat: 2 * km, lng: 0, typicalMinutes: 15, free: true };
const C = { id: 'c', name: 'C', lat: 3 * km, lng: 0, typicalMinutes: 45, free: false };
const D = { id: 'd', name: 'D', lat: 4 * km, lng: 0, typicalMinutes: 30, free: true };
const shuffled = [C, A, D, B];
const ids = (list) => list.map((l) => l.id);

describe('SORT_OPTIONS', () => {
  it('leads with nearest-to-me as the default', () => {
    expect(SORT_OPTIONS[0].id).toBe('nearest');
    expect(new Set(SORT_OPTIONS.map((o) => o.id)).size).toBe(SORT_OPTIONS.length);
  });
});

describe('orderStops', () => {
  it('nearest: a walkable chain, never a zig-zag past places you have to come back for', () => {
    // North, south, further north, further south of you. A plain sort by
    // distance-from-you visits them a, b, c, d (crossing back and forth);
    // the chain goes a, c then b, d.
    const o = { lat: 0, lng: 0 };
    const pts = [
      { id: 'a', lat: 0.01, lng: 0 },
      { id: 'b', lat: -0.011, lng: 0 },
      { id: 'c', lat: 0.02, lng: 0 },
      { id: 'd', lat: -0.021, lng: 0 },
    ];
    expect(ids(orderStops('nearest', o, pts))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('nearest: closest to you first, regardless of input order', () => {
    expect(ids(orderStops('nearest', origin, shuffled))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to nearest for an unknown sort id', () => {
    expect(ids(orderStops('bogus', origin, shuffled))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('route: a nearest-neighbor chain from you', () => {
    // On a line from the origin this is the same as nearest -- the point is
    // that it comes back annotated and in a walkable order.
    const out = orderStops('route', origin, shuffled);
    expect(ids(out)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[1].distanceFromPrevMeters).toBeGreaterThan(0);
  });

  it('rated: by average, then count, rated before unrated, nearest as tiebreak', () => {
    const ratings = {
      c: { avg: 4.8, count: 12 },
      d: { avg: 4.8, count: 3 },
      a: { avg: 3.1, count: 40 },
      // b unrated
    };
    expect(ids(orderStops('rated', origin, shuffled, ratings))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('quick: shortest typical visit first', () => {
    expect(ids(orderStops('quick', origin, shuffled))).toEqual(['b', 'd', 'c', 'a']);
  });

  it('free: free places first, nearest within each group', () => {
    expect(ids(orderStops('free', origin, shuffled))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('never mutates the input', () => {
    const input = [C, A, D, B];
    orderStops('nearest', origin, input);
    expect(ids(input)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('custom: the dragged order, verbatim', () => {
    expect(ids(orderStops('custom', origin, shuffled, {}, ['d', 'b', 'a', 'c']))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('custom: a stop just added (not yet in the saved order) lands at the end, nearest-first', () => {
    expect(ids(orderStops('custom', origin, shuffled, {}, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('custom: with no saved order at all, falls back to nearest-first', () => {
    expect(ids(orderStops('custom', origin, shuffled, {}, []))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('annotateRoute', () => {
  it('measures each leg from the previous stop, the first from the origin', () => {
    const out = annotateRoute(origin, [A, B, D]);
    expect(out[0].distanceFromPrevMeters).toBeCloseTo(1000, -2);
    expect(out[1].distanceFromPrevMeters).toBeCloseTo(1000, -2); // A -> B
    expect(out[2].distanceFromPrevMeters).toBeCloseTo(2000, -2); // B -> D
    for (const s of out) expect(s.travelMinutesFromPrev).toBe(estimateTravelMinutes(s.distanceFromPrevMeters));
  });

  it('keeps every field on the stop', () => {
    const [a] = annotateRoute(origin, [A]);
    expect(a).toMatchObject({ id: 'a', name: 'A', typicalMinutes: 60, free: false });
  });
});

describe('googleMapsMultiStopLink', () => {
  it('puts every stop in order: waypoints, then the last as the destination', async () => {
    const { googleMapsMultiStopLink } = await import('./routing');
    const url = new URL(googleMapsMultiStopLink([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }], { lat: 0, lng: 0 }, 'walking'));
    expect(url.searchParams.get('origin')).toBe('0,0');
    expect(url.searchParams.get('waypoints')).toBe('1,2|3,4');
    expect(url.searchParams.get('destination')).toBe('5,6');
    expect(url.searchParams.get('travelmode')).toBe('walking');
  });

  it('is null with no stops, and omits origin when unknown', async () => {
    const { googleMapsMultiStopLink } = await import('./routing');
    expect(googleMapsMultiStopLink([], null)).toBeNull();
    expect(new URL(googleMapsMultiStopLink([{ lat: 1, lng: 2 }], null)).searchParams.has('origin')).toBe(false);
  });
});
