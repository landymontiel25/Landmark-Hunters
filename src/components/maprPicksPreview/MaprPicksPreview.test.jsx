// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mapProps = vi.hoisted(() => ({ current: null }));
const reviews = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`r${i}`, { landmarkId: `r${i}`, ratingTier: 'worth-trying' }]));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me', email: 'landymontiel25@gmail.com' } }) }));
vi.mock('../../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: { tagScores: { milan: { food: 30 } } } }) }));
vi.mock('../../lib/RatingsContext', () => ({ useRatings: () => ({ ratings: {}, myReviews: reviews }) }));
vi.mock('../../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
vi.mock('../../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '1 mi' }));
vi.mock('../../lib/leaderboard', () => ({ getUserCheckins: async () => [], isRealCheckin: () => true }));
vi.mock('../../lib/pickReasonsApi', () => ({ fetchPickReasons: async () => ({}) }));
vi.mock('../../lib/recommendationLog', () => ({ logRecommendations: async () => [] }));
vi.mock('./PreviewMap', () => ({
  default: (props) => {
    mapProps.current = props;
    return <div data-testid="map" />;
  },
}));

import MaprPicksPreview from './MaprPicksPreview';

let container;
afterEach(() => {
  container?.remove();
  localStorage.clear();
});

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const choose = (select, value) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('MaprPicksPreview', () => {
  it('asks for location with no fix, then uses a simulated city', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <MaprPicksPreview />
        </MemoryRouter>
      )
    );
    expect(container.textContent).toContain('Turn on location to see picks near you.');
    expect(mapProps.current.center).toBeNull();

    await click(button(container, 'Milan'));
    expect(mapProps.current.center.lat).toBeCloseTo(45.46, 1);
    expect(container.textContent).not.toContain('Turn on location');

    await choose(container.querySelector('#mpp-preview-as'), 'new-user');
    expect(container.textContent).toContain('Rate 10 places and Mapr will start picking for you.');

    await choose(container.querySelector('#mpp-preview-as'), 'location-off');
    expect(container.textContent).toContain('Turn on location to see picks near you.');
  });
});
