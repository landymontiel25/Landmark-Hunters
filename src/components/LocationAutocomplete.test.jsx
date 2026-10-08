// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';

// placeId -> resolver for that suggestion's Place Details lookup.
const details = {};
vi.mock('../lib/places', () => ({
  searchPlaces: async () => [
    { placeId: 'a', primary: 'Hotel A', secondary: '1 A St' },
    { placeId: 'b', primary: 'Hotel B', secondary: '2 B St' },
  ],
  getPlaceDetails: (placeId) => new Promise((resolve) => (details[placeId] = resolve)),
  makeSessionToken: () => 'tok',
}));
vi.mock('../data/regions', () => ({ ALL_LANDMARKS: [], getRegion: () => null }));
vi.mock('../lib/TripContext', () => ({ useTrip: () => ({}) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({}) }));
vi.mock('../lib/geo', () => ({ nearestRegionId: () => null }));

import LocationAutocomplete from './LocationAutocomplete';

let container;
let root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('LocationAutocomplete', () => {
  it('keeps the last tapped suggestion when an earlier lookup finishes later', async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    function Box() {
      const [v, setV] = useState('hotel');
      return <LocationAutocomplete id="start" value={v} onChange={setV} onSelect={onSelect} />;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Box />));
    await act(async () => container.querySelector('input').focus());
    await act(async () => vi.advanceTimersByTime(300));
    const item = (name) => [...container.querySelectorAll('.autocomplete-item')].find((b) => b.textContent.includes(name));

    await act(async () => item('Hotel A').click());
    await act(async () => item('Hotel B').click());
    await act(async () => details.b({ primary: 'Hotel B', lat: 2, lng: 2 }));
    await act(async () => details.a({ primary: 'Hotel A', lat: 1, lng: 1 }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].primary).toBe('Hotel B');
  });
});
