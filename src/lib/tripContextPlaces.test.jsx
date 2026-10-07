// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TripProvider, useTrip } from './TripContext';

const place = { id: 'pl1', name: 'Joes Pizza', address: '', lat: 25.77, lng: -80.19, url: 'https://x.test' };

let api;
function Grab() {
  api = useTrip();
  return null;
}

beforeEach(() => localStorage.clear());

describe('removing a Mapr-found place', () => {
  it('also drops its id from the saved order, so no ghost itinerary is left behind', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(
        <TripProvider>
          <Grab />
        </TripProvider>
      );
    });
    await act(async () => api.addPlace('miami', place));
    // Edit List writes every stop id (places included) into the saved order.
    await act(async () => api.reorderLandmarks('miami', ['pl1']));
    await act(async () => api.removePlace('miami', 'pl1'));
    expect(api.regionsWithItineraries()).not.toContain('miami');
    expect(api.trip.byRegion.miami).toBeUndefined();
    await act(async () => root.unmount());
  });
});

describe('loading a saved trip', () => {
  it("keeps one copy of a stop saved under both a renamed landmark's old and new id", async () => {
    localStorage.setItem(
      'landmarkhunters.trip.v1',
      JSON.stringify({ byRegion: { 'san-francisco': ['the-battery', 'the-battery-sf', 'coit-tower'] } })
    );
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(
        <TripProvider>
          <Grab />
        </TripProvider>
      );
    });
    expect(api.trip.byRegion['san-francisco']).toEqual(['the-battery-sf', 'coit-tower']);
    await act(async () => root.unmount());
  });
});
