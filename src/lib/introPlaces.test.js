import { describe, it, expect } from 'vitest';
import { introPlaces, routeOrder, cityOf, shortName } from './introPlaces';

describe('introPlaces (the 5 images intro)', () => {
  it("is New York's Statue of Liberty, Central Park and Times Square", () => {
    const places = introPlaces();
    expect(places.map((p) => p.name)).toEqual(['Statue of Liberty', 'Central Park', 'Times Square']);
    expect(places.every((p) => p.images?.length)).toBe(true);
    expect(places.map((p) => p.introPhoto.url)).toEqual(['/intro/nyc-statue-clear-sky.jpg', '/intro/nyc-central-park.jpg', '/intro/nyc-times-square.jpg']);
    expect(places.every((p) => p.introPhoto.credit && p.introPhoto.page)).toBe(true);
    expect(cityOf(places[0])).toBe('New York');
  });

  it('routes from the stop closest to the user, then the closest one left', () => {
    const places = introPlaces();
    expect(routeOrder(places).map((p) => p.id)).toEqual(['statue-of-liberty', 'times-square', 'central-park']);
    const upperWestSide = { lat: 40.785, lng: -73.975 };
    expect(routeOrder(places, upperWestSide).map((p) => p.id)).toEqual(['central-park', 'times-square', 'statue-of-liberty']);
  });

  it('shortens long names for the map labels', () => {
    expect(shortName('Art Deco Historic District and Ocean Drive')).toBe('Art Deco Historic Dis…');
    expect(shortName('Milan Cathedral (Duomo di Milano)')).toBe('Milan Cathedral');
    expect(shortName('Times Square')).toBe('Times Square');
  });
});
