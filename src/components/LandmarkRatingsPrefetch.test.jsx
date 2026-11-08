// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const asked = [];
vi.mock('../lib/landmarkRatings', () => ({
  loadLandmarkRatings: (l) => {
    asked.push(l.id);
    return Promise.resolve({ google: { rating: 4.5, count: 10 }, tripadvisor: null, googleNoRating: false });
  },
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
vi.mock('../lib/ratingSources', () => ({ RATINGS_FLAGS: { cardLine: true } }));

const { default: LandmarkRatingsPrefetch, cityLandmarks, PREFETCH_START_MS } = await import('./LandmarkRatingsPrefetch');
const { setMapView } = await import('../lib/nearestCity');
const { ALL_LANDMARKS } = await import('../data/regions');

let root;
afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
});

describe('LandmarkRatingsPrefetch (owner, 2026-11-08)', () => {
  it('looks up Google ratings for the city the Map shows, before the Landmarks tab opens', async () => {
    vi.useFakeTimers();
    const miami = ALL_LANDMARKS.find((l) => l.regionId === 'miami');
    setMapView({ lat: miami.lat, lng: miami.lng });
    const el = document.createElement('div');
    root = createRoot(el);
    await act(async () => root.render(<LandmarkRatingsPrefetch />));
    expect(asked).toEqual([]);
    await act(async () => vi.advanceTimersByTime(PREFETCH_START_MS + 10));
    const ids = new Set(cityLandmarks('miami').map((l) => l.id));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((id) => ids.has(id))).toBe(true);
  });
});
