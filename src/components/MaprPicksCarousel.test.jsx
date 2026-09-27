// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LANDMARKS } from '../data/regions';

// Standing at Villanova, having visited everything there. The server
// (Firestore reads, /api/mapr-picks) never answers -- the row still has to
// fill right away from the on-device scorer.
const never = () => new Promise(() => {});
const net = { feedback: never, counts: never };
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: {}, profileFresh: false }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 40.0356, lng: -75.3437 } }) }));
vi.mock('../lib/BadgesContext', () => ({ useBadges: () => ({ reload: () => {}, actionsToday: 0 }) }));
vi.mock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedCustomInterests: [], customInterestMatches: {} } }) }));
vi.mock('../lib/pickFeedback', () => ({
  getPickFeedback: () => net.feedback(),
  readLocalFeedback: () => ({}),
  votedIds: () => [],
  setPickFeedback: () => {},
}));
vi.mock('../lib/leaderboard', () => ({ getGlobalCheckinCounts: () => net.counts(), getRegionCheckinCounts: () => net.counts() }));
vi.mock('../lib/friends', () => ({ recordShownPicks: () => never(), saveRebuiltTagScores: () => never(), saveSettledPicks: () => never() }));
vi.mock('../lib/apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('./RateLandmarkSearch', () => ({ default: () => null }));
vi.mock('./RateCityAhead', () => ({ default: () => null }));

import MaprPicksCarousel from './MaprPicksCarousel';

let container;
afterEach(() => {
  document.body.removeChild(container);
});

describe('Mapr Picks first paint', () => {
  it('fills the row immediately, from the nearest city with something new', async () => {
    vi.stubGlobal('fetch', () => never());
    const villanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova').map((l) => l.id);
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <MaprPicksCarousel reviews={[]} checkedInIds={villanova} />
        </MemoryRouter>
      )
    );
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    const picked = ALL_LANDMARKS.filter((l) => names.includes(l.name));
    expect(picked.every((l) => l.regionId !== 'villanova')).toBe(true);
    expect(container.textContent).not.toContain('Finding places');
    vi.unstubAllGlobals();
  });
});

describe('Mapr Picks never sticks on an empty row', () => {
  const villanova = () => ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
  const render = async (checkedInIds) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <MaprPicksCarousel reviews={[]} checkedInIds={checkedInIds} />
        </MemoryRouter>
      )
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    return [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
  };

  it('fills from on-device picks when the server only suggests places you visited', async () => {
    net.feedback = async () => ({});
    net.counts = async () => ({});
    const visited = villanova().slice(0, 3);
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ picks: visited.map((l) => ({ id: l.id, region: 'villanova', name: l.name })) }),
    }));
    const names = await render(visited.map((l) => l.id));
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => visited.some((l) => l.name === n))).toBe(false);
    expect(container.textContent).not.toContain('Rate a place directly');
    vi.unstubAllGlobals();
  });

  it('treats a cached list you already visited as a miss', async () => {
    net.feedback = async () => ({});
    net.counts = async () => ({});
    vi.stubGlobal('fetch', () => never());
    localStorage.clear();
    const visited = villanova().slice(0, 2);
    const origWrite = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (String(k).startsWith('lh-mapr-picks:')) {
        return JSON.stringify({ at: Date.now(), picks: visited.map((l) => ({ id: l.id, region: 'villanova', name: l.name })) });
      }
      return origWrite.call(this, k);
    };
    const names = await render(visited.map((l) => l.id));
    Storage.prototype.getItem = origWrite;
    expect(names.length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Rate a place directly');
    vi.unstubAllGlobals();
  });
});

describe('Mapr Picks dots', () => {
  it('lights the last dot once you scroll to the end of the row', async () => {
    net.feedback = async () => ({});
    net.counts = async () => ({});
    vi.stubGlobal('fetch', () => never());
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter>
          <MaprPicksCarousel reviews={[]} checkedInIds={[]} />
        </MemoryRouter>
      )
    );
    const dots = () => [...container.querySelectorAll('.mapr-picks-dot')];
    expect(dots().length).toBeGreaterThan(1);
    const track = container.querySelector('.mapr-picks-track');
    // jsdom has no layout: give the row the sizes a phone would.
    const sizes = { scrollWidth: 2000, clientWidth: 390, scrollLeft: 1610 };
    Object.entries(sizes).forEach(([k, v]) => Object.defineProperty(track, k, { value: v, configurable: true }));
    track.firstElementChild.getBoundingClientRect = () => ({ width: 250 });
    await act(async () => track.dispatchEvent(new Event('scroll')));
    expect(dots().at(-1).classList.contains('active')).toBe(true);
    vi.unstubAllGlobals();
  });
});
