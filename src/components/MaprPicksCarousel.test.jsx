// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LANDMARKS } from '../data/regions';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 40.0356, lng: -75.3437 } }) }));
const checkInMock = vi.fn();
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => ({ checkIn: checkInMock, user: { uid: 'me' } }) }));
vi.mock('./RateLandmarkSearch', () => ({ default: () => null }));

import MaprPicksCarousel from './MaprPicksCarousel';

let container;
afterEach(() => {
  document.body.removeChild(container);
  localStorage.clear();
  checkInMock.mockClear();
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
};

describe('Mapr Travel Picks', () => {
  it('fills the row for the nearest city (villanova, given the mocked GPS fix)', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    const villanovaLandmarks = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
    expect(names.every((n) => villanovaLandmarks.some((l) => l.name === n))).toBe(true);
  });

  it('excludes landmarks already reviewed or checked into', async () => {
    const villanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
    await render({
      reviews: [{ landmarkId: villanova[0].id }],
      checkedInIds: [villanova[1].id],
    });
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    expect(names).not.toContain(villanova[0].name);
    expect(names).not.toContain(villanova[1].name);
  });

  it('opens the rate-and-post flow, pre-seeded on the tapped tier, when a rate button is tapped', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const loveButton = container.querySelector('.mapr-pick-vote.love');
    await act(async () => loveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(checkInMock).toHaveBeenCalledTimes(1);
    const [, options] = checkInMock.mock.calls[0];
    expect(options).toEqual({ ratingOnly: true, initialTier: 'highly-recommend' });
  });

  it('lets you switch cities from the header button', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const cityButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Villanova University'));
    expect(cityButton).toBeTruthy();
    await act(async () => cityButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('.modal-card')).toBeTruthy();
    expect(document.body.textContent).toContain('Choose a City');
  });
});

describe('Mapr Travel Picks dots', () => {
  it('lights the last dot once you scroll to the end of the row', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const dots = () => [...container.querySelectorAll('.mapr-picks-dot')];
    expect(dots().length).toBeGreaterThan(1);
    const track = container.querySelector('.mapr-picks-track');
    const sizes = { scrollWidth: 2000, clientWidth: 390, scrollLeft: 1610 };
    Object.entries(sizes).forEach(([k, v]) => Object.defineProperty(track, k, { value: v, configurable: true }));
    track.firstElementChild.getBoundingClientRect = () => ({ width: 250 });
    await act(async () => track.dispatchEvent(new Event('scroll')));
    expect(dots().at(-1).classList.contains('active')).toBe(true);
  });
});
