// @vitest-environment jsdom
// Owner, 2026-10-18: a Travel Picks card with no picture shouldn't show
// unless every place that has one is already answered.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LANDMARKS } from '../data/regions';

const fs = vi.hoisted(() => ({ setDoc: vi.fn(), store: new Map() }));
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig()),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: (...a) => fs.setDoc(...a),
  getDocs: async () => ({ docs: [] }),
  runTransaction: async () => {},
  serverTimestamp: () => 0,
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
}));
vi.mock('../lib/firebase', async (orig) => ({ ...(await orig()), db: {} }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
const shown = vi.hoisted(() => []);
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: { tagScores: {} } }) }));
vi.mock('../lib/recommendationLog', () => ({ logShownPicks: (a) => { shown.push(a); return Promise.resolve(); } }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 40.0356, lng: -75.3437 } }) }));
const solo = vi.hoisted(() => ({ closes: 0, reply: { ok: true, closed: true } }));
vi.mock('../lib/soloStreaks', () => ({ closeSoloToday: () => { solo.closes += 1; return Promise.resolve(solo.reply); } }));
vi.mock('../lib/BadgesContext', () => ({ useBadges: () => ({ reload: () => {}, actionsToday: 0 }) }));
vi.mock('./RateLandmarkSearch', () => ({ default: () => null }));

const photo = vi.hoisted(() => ({ lookups: 0 }));
vi.mock('../lib/placePhoto', async (orig) => ({
  ...(await orig()),
  peekPlacePhoto: () => undefined,
  loadPlacePhoto: async () => {
    photo.lookups += 1;
    return null;
  },
}));
import MaprPicksCarousel from './MaprPicksCarousel';

let container;
afterEach(() => {
  document.body.removeChild(container);
  localStorage.clear();
});
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <MaprPicksCarousel {...props} />
      </MemoryRouter>
    )
  );
  await act(async () => {});
};
const names = () => [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
const villanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');

describe('Mapr Travel Picks: cards need a picture', () => {
  it('leaves out places with no photo while places with one are left', async () => {
    const noPhoto = villanova.filter((l) => !l.images?.length).map((l) => l.name);
    await render({ reviews: [], checkedInIds: [] });
    expect(names().length).toBeGreaterThan(0);
    expect(names().some((n) => noPhoto.includes(n))).toBe(false);
  });

  it('shows photo-less places once every place with a photo is answered', async () => {
    const withPhoto = villanova.filter((l) => l.images?.length);
    const noPhoto = villanova.filter((l) => !l.images?.length);
    if (!noPhoto.length) return;
    await render({ reviews: [], checkedInIds: withPhoto.map((l) => l.id) });
    expect(names().length).toBeGreaterThan(0);
    expect(names().every((n) => noPhoto.some((l) => l.name === n))).toBe(true);
  });
});
