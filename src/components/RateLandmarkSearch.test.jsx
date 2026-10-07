// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Each searchPlaces call gets its own deferred, resolved by the test.
const pending = [];
vi.mock('../lib/places', () => ({
  searchPlaces: (q) =>
    new Promise((resolve) => {
      pending.push({ q, resolve });
    }),
  getPlaceDetails: vi.fn(),
  makeSessionToken: () => 'tok',
}));
vi.mock('../data/regions', () => ({ ALL_LANDMARKS: [], INTERESTS: [], getRegion: () => null }));
vi.mock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => [] }));
vi.mock('../lib/placeLandmarks', () => ({ createLandmarkFromPlace: vi.fn() }));
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => ({ checkIn: vi.fn(), user: null }) }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ resendVerification: vi.fn() }) }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
vi.mock('../lib/smartSearch', () => ({
  useSmartSearch: () => ({ ids: [], loading: false }),
  landmarkSearchText: () => '',
}));

import RateLandmarkSearch from './RateLandmarkSearch';

let container;
afterEach(() => {
  document.body.innerHTML = '';
  pending.length = 0;
  vi.useRealTimers();
});

async function type(value) {
  const input = document.body.querySelector('input[name="rate-search"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('RateLandmarkSearch', () => {
  it("doesn't let an older, slower Places search overwrite the newer one", async () => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<RateLandmarkSearch />));
    await act(async () => container.querySelector('button').click());

    await type('pizz');
    await act(async () => vi.advanceTimersByTime(300));
    await type('pizza hut');
    await act(async () => vi.advanceTimersByTime(300));
    expect(pending.map((p) => p.q)).toEqual(['pizz', 'pizza hut']);

    // Newer answer first, then the stale one arrives late.
    await act(async () => pending[1].resolve([{ placeId: 'new', primary: 'Pizza Hut Main St' }]));
    await act(async () => pending[0].resolve([{ placeId: 'old', primary: 'Pizzeria Uno' }]));

    expect(document.body.textContent).toContain('Pizza Hut Main St');
    expect(document.body.textContent).not.toContain('Pizzeria Uno');
  });
});
