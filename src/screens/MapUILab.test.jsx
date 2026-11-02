// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

const place = (id, name, categories, extra = {}) => ({ id, regionId: 'miami', region: 'miami', name, categories, lat: 25.77, lng: -80.19, distanceMeters: 400, images: [], ...extra });
const PICKS = [place('pura-vida', 'Pura Vida', ['food'], { rating: { avg: 4.8, count: 1200 } })];
const POOL = [
  ...PICKS,
  place('panther', 'Panther Coffee', ['food'], { summary: 'A coffee roaster' }),
  place('park', 'Bayfront Park', ['parks-nature']),
  place('pamm', 'PAMM', ['history-culture']),
];

function Where() {
  return <p className="where">{useLocation().pathname}</p>;
}

async function render({ state = 'ready', liked = null, similar = [] } = {}) {
  const logged = [];
  const vote = vi.fn();
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c', displayName: 'Landy Montiel' }, firebaseEnabled: false }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19, accuracy: 20 }, error: null, lastKnown: null }) }));
  vi.doMock('../lib/UnitsContext', async () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: (await import('../lib/formatDistance')).formatDistance }));
  vi.doMock('../lib/useWhereAmI', () => ({ useWhereAmI: () => ({ coords: { lat: 25.77, lng: -80.19 }, here: { label: 'Villanova University, South Ithan Avenue' }, near: null, traveling: false, text: 'Villanova University, South Ithan Avenue' }) }));
  vi.doMock('../lib/usePickVotes', () => ({ usePickVotes: () => ({ votes: {}, removed: new Set(), vote }) }));
  vi.doMock('../components/nearbyPicks/useMapPicks', () => ({
    useMapPicks: () => ({
      uid: 'u',
      state,
      picks: PICKS,
      pool: POOL,
      ratings: {},
      ratingsCount: 4,
      distance: 1,
      chooseDistance: () => {},
      rankRow: (items) => items,
      rowLogger: (source) => (items) => logged.push([source, items.map((p) => p.id)]),
      origin: { lat: 25.77, lng: -80.19 },
      liked,
      similar,
      onSimilarShown: (items) => logged.push(['because-you-liked', items.map((p) => p.id)]),
    }),
  }));
  const { default: MapUILab } = await import('./MapUILab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<MapUILab />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
  });
  return { el: container, logged, vote };
}

const click = (el) => act(async () => el.click());

describe('MapUILab (Test tab: UI > Map)', () => {
  it('shows the header, where you are, the map buttons and the folded picks bar', async () => {
    const { el } = await render();
    expect(el.querySelector('.mul-brand').textContent).toBe('LandmarkHunters');
    expect(el.querySelector('.mul-avatar').textContent).toBe('LM');
    expect(el.querySelector('.mul-where').textContent).toContain('Villanova University, South Ithan Avenue');
    expect(el.querySelector('[aria-label="Search places"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Add a landmark"]')).toBeTruthy();
    expect(el.querySelector('.mul-dist').textContent).toContain('1 mi');
    expect(el.querySelector('.mul-peek').textContent).toContain('Picked for you right now');
    expect(el.querySelector('.mul-sheet').getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.leaflet-container')).toBeTruthy();
  });

  it('opening the bar shows Mapr picks first, then the rest, and logs them once shown', async () => {
    const { el, logged } = await render();
    expect(logged).toEqual([]);
    await click(el.querySelector('.mul-peek'));
    expect(el.querySelector('.mul-sheet').getAttribute('aria-hidden')).toBe('false');
    const names = [...el.querySelectorAll('.mul-row strong')].map((n) => n.textContent);
    expect(names).toEqual(['Pura Vida', 'Panther Coffee', 'Bayfront Park', 'PAMM']);
    expect(el.querySelector('.mul-row-meta').textContent).toContain('4.8 (1.2k)');
    expect(logged[0]).toEqual(['ui-nearby-all', ['pura-vida', 'panther', 'park', 'pamm']]);
  });

  it('the category tiles filter the list', async () => {
    const { el } = await render();
    await click(el.querySelector('.mul-peek'));
    expect([...el.querySelectorAll('.mul-cat')].map((c) => c.textContent)).toEqual(['All', 'Restaurants', 'Cafés', 'Nightlife', 'Outdoors', 'Culture']);
    const tile = (label) => [...el.querySelectorAll('.mul-cat')].find((c) => c.textContent === label);
    await click(tile('Cafés'));
    expect([...el.querySelectorAll('.mul-row strong')].map((n) => n.textContent)).toEqual(['Panther Coffee']);
    await click(tile('Outdoors'));
    expect([...el.querySelectorAll('.mul-row strong')].map((n) => n.textContent)).toEqual(['Bayfront Park']);
    await click(tile('Nightlife'));
    expect(el.querySelector('.mul-note').textContent).toContain('Nothing like this within 1 mi');
  });

  it('tapping a row highlights it; tapping again opens its page', async () => {
    const { el } = await render();
    await click(el.querySelector('.mul-peek'));
    await click(el.querySelector('.mul-row-main'));
    expect(el.querySelector('.mul-row').classList.contains('on')).toBe(true);
    await click(el.querySelector('.mul-row-main'));
    expect(el.querySelector('.where').textContent).toBe('/landmarks/miami/pura-vida');
  });

  it('Because you liked: cards with Directions and the three answers', async () => {
    const similar = [place('il-fiore', 'Il Fiore', ['food'])];
    const { el, vote, logged } = await render({ liked: { name: 'Fogo de Chão' }, similar });
    await click(el.querySelector('.mul-peek'));
    expect(el.querySelector('.mul-because').textContent).toBe('Because you liked Fogo de Chão');
    expect(el.querySelector('.mul-card h4').textContent).toBe('Il Fiore');
    expect(el.querySelector('.mul-dir').textContent).toContain('Directions');
    const votes = [...el.querySelectorAll('.mul-vote')];
    expect(votes.map((v) => v.textContent.trim())).toEqual(['✕ Not for me', '🤷 Not sure', "✓ I'd go"]);
    await click(votes[2]);
    expect(vote).toHaveBeenCalledWith(expect.objectContaining({ id: 'il-fiore', region: 'miami' }), 'yes');
    expect(logged).toContainEqual(['because-you-liked', ['il-fiore']]);
  });

  it('under 10 ratings it asks for more instead of a list', async () => {
    const { el } = await render({ state: 'locked' });
    await click(el.querySelector('.mul-peek'));
    expect(el.querySelector('.mul-note').textContent).toMatch(/Rate 6 more/);
    expect(el.querySelector('.mul-row')).toBeNull();
  });

  it('search finds landmarks by name', async () => {
    const { el } = await render();
    await click(el.querySelector('[aria-label="Search places"]'));
    const input = el.querySelector('.mul-search input');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, 'Vizcaya');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.querySelector('.mul-results').textContent).toContain('Vizcaya');
  });
});
