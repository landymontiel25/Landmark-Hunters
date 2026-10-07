import { describe, it, expect } from 'vitest';
import { nearestPickableCity, setMapView, getMapView } from './nearestCity';

const landmarks = [
  { regionId: 'a', lat: 10, lng: 10 },
  { regionId: 'b', lat: 10.2, lng: 10 },
  { regionId: 'f1', lat: 10.01, lng: 10 },
];
const cities = [{ id: 'a' }, { id: 'b' }];

describe('nearestPickableCity', () => {
  it('picks the city of the closest landmark and skips non-city regions', () => {
    expect(nearestPickableCity({ lat: 10.001, lng: 10 }, 30, landmarks, cities)).toBe('a');
    expect(nearestPickableCity({ lat: 10.19, lng: 10 }, 30, landmarks, cities)).toBe('b');
  });
  it('is null far from every city or with no point', () => {
    expect(nearestPickableCity({ lat: 50, lng: 50 }, 30, landmarks, cities)).toBeNull();
    expect(nearestPickableCity(null, 30, landmarks, cities)).toBeNull();
  });
});

describe('map view memory', () => {
  it('remembers a point and forgets on null', () => {
    setMapView({ lat: 1, lng: 2 });
    expect(getMapView()).toEqual({ lat: 1, lng: 2 });
    setMapView(null);
    expect(getMapView()).toBeNull();
  });
});
