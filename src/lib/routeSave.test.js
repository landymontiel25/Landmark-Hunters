import { describe, it, expect } from 'vitest';
import { mergeRouteOrder, sameOrder } from './routeSave';

describe('mergeRouteOrder', () => {
  it('puts the route stops in their new order, in their own slots', () => {
    // v was visited, so it wasn't on the route and stays where it is.
    expect(mergeRouteOrder(['a', 'v', 'b', 'c'], ['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'v', 'a', 'b']);
  });
  it('keeps a stop dropped from the route on the itinerary, after the kept ones', () => {
    expect(mergeRouteOrder(['a', 'b', 'c'], ['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });
  it('ignores route stops that are not on this itinerary', () => {
    expect(mergeRouteOrder(['a', 'b'], ['a', 'x', 'b'], ['b', 'x', 'a'])).toEqual(['b', 'a']);
  });
  it('compares orders', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
