import { describe, it, expect } from 'vitest';
import { asksForDirections, directionsTarget, nameKeys, placesNamedIn } from './_lib/placeMatch.js';

const hillstone = { id: 'hillstone', regionId: 'miami', name: 'Hillstone Restaurant', lat: 25.75, lng: -80.26 };
const vizcaya = { id: 'vizcaya', regionId: 'miami', name: 'Vizcaya Museum & Gardens', lat: 25.744, lng: -80.21 };
const joes = { id: 'joes', regionId: 'miami', name: "Joe's Cafe", lat: 25.77, lng: -80.19 };
const sbNear = { id: 'sb1', regionId: 'miami', name: 'Starbucks', lat: 25.761, lng: -80.191 };
const sbFar = { id: 'sb2', regionId: 'miami', name: 'Starbucks', lat: 25.69, lng: -80.31 };
const places = [hillstone, vizcaya, joes, sbNear, sbFar];

describe('placeMatch', () => {
  it('drops generic words only when the rest stays distinctive', () => {
    expect(nameKeys('Hillstone Restaurant')).toEqual(['hillstone restaurant', 'hillstone']);
    expect(nameKeys("Joe's Cafe")).toEqual(['joe cafe']);
    expect(nameKeys('Thank You Miami')).toEqual(['thank you miami']);
    expect(nameKeys('Sanguich de Miami')).toEqual(['sanguich de miami', 'sanguich']);
  });

  it('spots directions questions', () => {
    for (const q of ['How do I get to Hillstone?', 'directions to vizcaya', 'Take me to Hillstone', "where's hillstone", 'how can we get there']) {
      expect(asksForDirections(q)).toBe(true);
    }
    for (const q of ['Something fun tonight', 'Is Hillstone good?']) expect(asksForDirections(q)).toBe(false);
  });

  it('finds the places a message names, by whole words', () => {
    expect(placesNamedIn('How do I get to Hillstone?', places)).toEqual([hillstone]);
    expect(placesNamedIn("hillstone's hours", places)).toEqual([hillstone]);
    expect(placesNamedIn('directions to Vizcaya Museum and Gardens', places)).toEqual([vizcaya]);
    expect(placesNamedIn('Hillstoned', places)).toEqual([]);
    expect(placesNamedIn('ok', places)).toEqual([]);
  });

  it('picks the one place a directions question means', () => {
    expect(directionsTarget('How do I get to Hillstone?', places)).toBe(hillstone);
    expect(directionsTarget('Is Hillstone good?', places)).toBeNull();
    expect(directionsTarget('How do I get to the beach?', places)).toBeNull();
    expect(directionsTarget('directions to Vizcaya Museum & Gardens', places)).toBe(vizcaya);
    // Two different places named: unclear which.
    expect(directionsTarget("directions to Hillstone or Joe's Cafe", places)).toBeNull();
    // "Biltmore" also starts the Biltmore Hotel's name.
    const bar = { id: 'bar', regionId: 'miami', name: 'The Biltmore Bar', lat: 25.72, lng: -80.28 };
    const hotel = { id: 'hotel', regionId: 'miami', name: 'The Biltmore Hotel', lat: 25.72, lng: -80.28 };
    expect(directionsTarget('directions to the Biltmore', [bar, hotel])).toBeNull();
    expect(directionsTarget('directions to the Biltmore Hotel', [bar, hotel])).toBe(hotel);
  });

  it('picks the nearest branch of a chain, and only with a location', () => {
    expect(directionsTarget('take me to Starbucks', places)).toBeNull();
    expect(directionsTarget('take me to Starbucks', places, { lat: 25.76, lng: -80.19 })).toBe(sbNear);
    expect(directionsTarget('take me to Starbucks', places, { lat: 25.69, lng: -80.31 })).toBe(sbFar);
  });
});
