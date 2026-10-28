// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TEST_MOODS } from '../../lib/nearbyPicks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../lib/UnitsContext', () => ({
  useUnits: () => ({ units: 'imperial' }),
  formatDistance: (m) => `${(m / 1609.34).toFixed(1)} mi`,
}));

import MoodCarousel from './MoodCarousel';

let container;
afterEach(() => container?.remove());
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <MoodCarousel pool={[]} ratings={{}} {...props} />
      </MemoryRouter>
    )
  );
  return container;
};

const tab = (el, label) => [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(label));
const labels = (el) => [...el.querySelectorAll('.mpp-mood')].map((b) => b.textContent);

describe('MoodCarousel', () => {
  it('opens on Top landmarks with Places beside it, and the moods only show under Places', async () => {
    const el = await render();
    expect([...el.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual([expect.stringContaining('Top landmarks'), expect.stringContaining('Places')]);
    expect(tab(el, 'Top landmarks').getAttribute('aria-selected')).toBe('true');
    expect(labels(el)).toEqual([]);
    await act(async () => tab(el, 'Places').click());
    expect(tab(el, 'Places').getAttribute('aria-selected')).toBe('true');
    expect(labels(el)[0]).toContain('Something to eat');
    expect(labels(el).some((l) => l.includes('Tech spots'))).toBe(true);
  });

  it('shows the moods it is given: eating first, and no tech spots or Fresh air on the Map', async () => {
    const el = await render({ moods: TEST_MOODS });
    await act(async () => tab(el, 'Places').click());
    const l = labels(el);
    expect(l[0]).toContain('Something to eat');
    expect(l[1]).toContain('Art & culture');
    expect(l.some((x) => x.includes('Tech spots'))).toBe(false);
    expect(l.some((x) => x.includes('Fresh air'))).toBe(false);
    expect(el.querySelector('.mpp-section-title').textContent).toBe('Discover top landmarks');
  });

  it('Top landmarks lists the best places of every kind, highest rated first', async () => {
    const mk = (id, categories, d) => ({ id, region: 'miami', regionId: 'miami', name: id, lat: 25.76, lng: -80.19, categories, distanceMeters: d, image: null });
    const pool = [mk('near-cafe', ['food'], 100), mk('park', ['parks-nature'], 300), mk('museum', ['history-culture'], 500)];
    const ratings = { museum: { avg: 4.8, count: 200 }, park: { avg: 5, count: 1 } };
    const el = await render({ pool, ratings, moods: TEST_MOODS });
    const names = [...el.querySelectorAll('.mpp-card, .mpp-row')].map((c) => c.textContent);
    expect(names[0]).toContain('museum');
    expect(names.some((n) => n.includes('park'))).toBe(true);
    expect(names.some((n) => n.includes('near-cafe'))).toBe(true);
  });

  it('switches between carousel and list, and remembers the choice', async () => {
    localStorage.removeItem('lh.moodView');
    const pool = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      region: 'miami',
      regionId: 'miami',
      name: `Place ${i}`,
      lat: 25.76,
      lng: -80.19,
      categories: ['food'],
      distanceMeters: 100 * (i + 1),
      image: null,
    }));
    const el = await render({ pool, moods: TEST_MOODS, initialMood: 'eat' });
    expect(el.querySelector('.mpp-carousel:not(.mpp-moods)')).toBeTruthy();
    expect(el.querySelector('.mpp-mood-list')).toBeNull();
    const list = [...el.querySelectorAll('.mpp-view-toggle button')].find((b) => b.textContent === 'List');
    await act(async () => list.click());
    expect(el.querySelector('.mpp-mood-list').querySelectorAll('.mpp-row').length).toBe(4);
    expect(el.querySelector('.mpp-carousel:not(.mpp-moods)')).toBeNull();
    expect(localStorage.getItem('lh.moodView')).toBe('list');
    container.remove();
    const again = await render({ pool, moods: TEST_MOODS, initialMood: 'eat' });
    expect(again.querySelector('.mpp-mood-list')).toBeTruthy();
    localStorage.removeItem('lh.moodView');
  });
});
