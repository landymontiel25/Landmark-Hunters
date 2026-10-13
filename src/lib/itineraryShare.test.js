import { describe, it, expect } from 'vitest';
import { itineraryShareText } from './itineraryShare';

const stop = (name, lat) => ({ name, lat, lng: -80.2 });

describe('itineraryShareText', () => {
  it('lists the stops in order with a Google Maps route and the app link', () => {
    const t = itineraryShareText({ name: 'Miami', regionName: 'Miami', stops: [stop('Vizcaya', 25.74), stop('Wynwood Walls', 25.8)] });
    expect(t).toMatch(/^🗺️ My Miami trip/);
    expect(t).toContain('1. Vizcaya\n2. Wynwood Walls');
    expect(t).toMatch(/Route in Google Maps: https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    expect(t).not.toContain('origin=');
    expect(t).toContain('https://landmarkhunters.com');
  });

  it('uses the itinerary name and splits long routes into parts', () => {
    const stops = Array.from({ length: 12 }, (_, i) => stop(`Stop ${i + 1}`, 25 + i / 100));
    const t = itineraryShareText({ name: 'Spring Break', regionName: 'Miami', stops });
    expect(t).toMatch(/^🗺️ Spring Break \(Miami\)/);
    expect(t).toContain('Route part 1 of 2');
    expect(t).toContain('12. Stop 12');
  });
});
