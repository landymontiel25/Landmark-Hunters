import { describe, it, expect } from 'vitest';
import { findLookedUp, lookedUpPlaces, lookedUpNamedIn } from './lookedUpPlaces.js';

// Owner report 2026-10-18: Mapr named three tennis courts with distances
// from its route lookups, but showed no cards (no web source URL).
const results = [
  { tool: 'route_between', out: { from: { name: 'your location' }, to: { name: 'Biltmore Tennis Center', address: '1150 Anastasia Ave, Coral Gables' }, miles: 1.2 } },
  { tool: 'best_order', out: { legs: [{ from: { name: 'Salvadore Park', address: '1120 Andalusia Ave' }, to: { name: 'Neighborhood Tennis', address: '' } }] } },
  { tool: 'place_hours', out: { name: 'Old Club', address: 'x', permanentlyClosed: true } },
  { tool: 'route_between', out: { error: 'Couldn’t find "Nowhere".' } },
];

describe('lookedUpPlaces', () => {
  it('collects real places from route, order and hours lookups', () => {
    expect(lookedUpPlaces(results).map((p) => p.name)).toEqual(['Biltmore Tennis Center', 'Salvadore Park', 'Neighborhood Tennis']);
  });

  it('matches a stop name to the place a lookup found', () => {
    const places = lookedUpPlaces(results);
    expect(findLookedUp('Biltmore Tennis Center', places)?.address).toBe('1150 Anastasia Ave, Coral Gables');
    expect(findLookedUp('Salvadore Park Tennis Center', places)?.name).toBe('Salvadore Park');
    expect(findLookedUp('Some Other Place', places)).toBeNull();
  });

  it('finds the looked-up places a reply names, in reply order', () => {
    const reply = 'Three options: Neighborhood Tennis is 2.3 mi, Biltmore Tennis Center is 1.2 mi, and Salvadore Park is 2.1 mi.';
    expect(lookedUpNamedIn(reply, lookedUpPlaces(results)).map((p) => p.name)).toEqual(['Neighborhood Tennis', 'Biltmore Tennis Center', 'Salvadore Park']);
  });
});
