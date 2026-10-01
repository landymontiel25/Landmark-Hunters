// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useParams, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/UnitsContext', () => ({
  useUnits: () => ({ units: 'imperial' }),
  formatDistance: (m) => `${(m / 1609.34).toFixed(1)} mi`,
}));

import PicksBottomSheet from './PicksBottomSheet';

const pick = (id, extra = {}) => ({
  id,
  region: 'villanova',
  name: `Place ${id}`,
  image: `https://img.example/${id}.jpg`,
  categories: ['food'],
  distanceMeters: 800,
  pickType: 'usual',
  reason: `Reason ${id}`,
  lat: 40,
  lng: -75,
  ...extra,
});
const PICKS = [pick('a'), pick('b'), pick('c', { pickType: 'new' }), pick('d', { chain: { from: 'art-museums', to: 'food', count: 3 } })];

let container;
afterEach(() => container?.remove());
afterEach(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
function LandmarkPage() {
  const { region, id } = useParams();
  return <p>landmark page {region}/{id}</p>;
}
function Landing() {
  const loc = useLocation();
  return <p data-testid="landing">{loc.state?.directionsTo ? `route to ${loc.state.directionsTo.name}` : 'plain'}</p>;
}
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<PicksBottomSheet expanded={false} onExpandedChange={() => {}} {...props} />} />
          <Route path="/landmarks/:region/:id" element={<LandmarkPage />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/landmarks" element={<p>landmarks tab</p>} />
        </Routes>
      </MemoryRouter>
    )
  );
  return container;
};
const click = (el) => act(async () => el.click());
const sheetButton = (text) => [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent.includes(text));

describe('PicksBottomSheet', () => {
  it('opens on the top three picks', async () => {
    const el = await render({ picks: PICKS });
    expect(el.querySelectorAll('.mpp-row')).toHaveLength(3);
    expect(el.textContent).toContain('Picked for you right now');
  });

  it('expanded: four cards with name, distance, reason and Directions, plus the chain label when asked', async () => {
    const el = await render({ picks: PICKS, expanded: true, showChainLabels: true });
    const cards = el.querySelectorAll('.mpp-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].textContent).toContain('Place a');
    expect(cards[0].textContent).toContain('0.5 mi');
    expect(cards[0].textContent).toContain('Reason a');
    expect(cards[0].textContent).toContain('Directions');
    expect(cards[2].textContent).toContain('Something new');
    expect(cards[3].querySelector('.mpp-chain').textContent).toContain('Art & Museums');
  });

  it('never shows the chain label unless asked (real tabs)', async () => {
    const el = await render({ picks: PICKS, expanded: true });
    expect(el.querySelector('.mpp-chain')).toBeNull();
  });

  const swipeOn = (el) => (from, to) =>
    act(async () => {
      const grip = el.querySelector('.mpp-sheet-grip');
      grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: from }));
      grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: to }));
    });

  it('swipe up expands, swipe down collapses', async () => {
    const onExpandedChange = vi.fn();
    const el = await render({ picks: PICKS, onExpandedChange });
    await swipeOn(el)(400, 300);
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    container.remove();
    const open = await render({ picks: PICKS, onExpandedChange, expanded: true });
    await swipeOn(open)(300, 400);
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it('swipe down on the collapsed sheet minimizes it to its title; swipe up or a tap brings it back', async () => {
    const onMinimizedChange = vi.fn();
    const el = await render({ picks: PICKS, onMinimizedChange });
    await swipeOn(el)(300, 400);
    expect(onMinimizedChange).toHaveBeenLastCalledWith(true);
    container.remove();
    const min = await render({ picks: PICKS, onMinimizedChange, minimized: true });
    expect(min.querySelector('.mpp-sheet').classList.contains('minimized')).toBe(true);
    await swipeOn(min)(400, 300);
    expect(onMinimizedChange).toHaveBeenLastCalledWith(false);
  });

  it('tapping a row opens Directions or the landmark page', async () => {
    const el = await render({ picks: PICKS });
    await click(el.querySelector('.mpp-row-main'));
    expect(document.querySelector('.modal-card').textContent).toContain('Place a');
    expect(sheetButton('Directions')).toBeTruthy();
    // Directions opens the app's usual Get Directions choices.
    await click(sheetButton('Directions'));
    expect(document.body.textContent).toContain('Use Google Maps');
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    container.remove();

    const again = await render({ picks: PICKS });
    await click(again.querySelector('.mpp-row-main'));
    await click(sheetButton('Open landmark page'));
    expect(again.textContent).toContain('landmark page villanova/a');
    expect(document.querySelector('.modal-card')).toBeNull();
  });

  it('"Use the Map" from a pick closes the pick sheet instead of leaving it over the route', async () => {
    const el = await render({ picks: PICKS });
    await click(el.querySelector('.mpp-row-main'));
    await click(sheetButton('Directions'));
    const useMap = [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent.includes('Use the Map'));
    await click(useMap);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  it('a mouse drag that leaves the grip still counts: the pointer is captured on press', async () => {
    const onExpandedChange = vi.fn();
    const el = await render({ picks: PICKS, onExpandedChange });
    const grip = el.querySelector('.mpp-sheet-grip');
    grip.setPointerCapture = vi.fn();
    await act(async () => {
      const down = new MouseEvent('pointerdown', { bubbles: true, clientY: 400 });
      Object.assign(down, { pointerId: 7 });
      grip.dispatchEvent(down);
    });
    expect(grip.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('a cancelled gesture does not leave a stale start that turns the next release into a swipe', async () => {
    const onExpandedChange = vi.fn();
    const el = await render({ picks: PICKS, onExpandedChange });
    const grip = el.querySelector('.mpp-sheet-grip');
    await act(async () => {
      grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 400 }));
      grip.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 100 }));
    });
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('tapping an expanded card opens the same choices', async () => {
    const el = await render({ picks: PICKS, expanded: true });
    await click(el.querySelectorAll('.mpp-card-main')[1]);
    expect(document.querySelector('.modal-card').textContent).toContain('Place b');
    await click(sheetButton('Open landmark page'));
    expect(el.textContent).toContain('landmark page villanova/b');
  });

  it('shows the current distance even while collapsed, and tapping it expands', async () => {
    const onExpandedChange = vi.fn();
    const el = await render({ picks: PICKS, distanceMiles: 1, onExpandedChange });
    const pill = [...el.querySelectorAll('.mpp-pill-distance')].find((b) => b.textContent.includes('Within 1 mi'));
    expect(pill).toBeTruthy();
    await click(pill);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('hides the distance pill while minimized or without a value', async () => {
    expect((await render({ picks: PICKS, distanceMiles: null })).querySelector('.mpp-pill-distance')).toBeNull();
    container.remove();
    const min = await render({ picks: PICKS, distanceMiles: 10, minimized: true });
    expect(min.querySelector('.mpp-pill-distance')).toBeNull();
  });

  it('hides the collapsed distance pill once expanded (the Within chips show the value)', async () => {
    const el = await render({ picks: PICKS, distanceMiles: 10, expanded: true, toolbar: <div className="tb" /> });
    expect(el.querySelector('.mpp-pill-distance')).toBeNull();
  });

  it('locked state has a Rate places button that goes to the Landmarks tab', async () => {
    const el = await render({ state: 'locked', ratingsCount: 3 });
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Rate places'));
    expect(btn).toBeTruthy();
    await click(btn);
    expect(document.body.textContent).toContain('landmarks tab');
  });

  it('has no refresh button on the real Map, and one right after the title in the Test tab', async () => {
    const plain = await render({ picks: PICKS });
    expect(plain.querySelector('.mpp-refresh')).toBeNull();
    container.remove();
    const onRefresh = vi.fn();
    const el = await render({ picks: PICKS, onRefresh });
    const btn = el.querySelector('.mpp-refresh');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Show different places');
    const head = el.querySelector('.mpp-sheet-head');
    expect([...head.children].map((c) => c.tagName)).toEqual(['H2', 'BUTTON']);
    await click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('tapping refresh does not also expand or collapse the sheet', async () => {
    const onExpandedChange = vi.fn();
    const onRefresh = vi.fn();
    const el = await render({ picks: PICKS, onRefresh, onExpandedChange });
    const btn = el.querySelector('.mpp-refresh');
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 300 }));
      btn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 300 }));
      btn.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      btn.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('spins and disables the button while a new set is loading', async () => {
    const el = await render({ picks: PICKS, onRefresh: () => {}, refreshing: true });
    const btn = el.querySelector('.mpp-refresh');
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('spinning')).toBe(true);
  });

  describe('mood-first layout (Test tab)', () => {
    const MOODS = <section className="mpp-section" data-testid="moods"><h3 className="mpp-section-title">What are you in the mood for?</h3></section>;

    it('puts the mood cards first, then one card with the top three, a Directions button each, and refresh by the title', async () => {
      const onRefresh = vi.fn();
      const el = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS, onRefresh, distanceMiles: 10 });
      const scroll = el.querySelector('.mpp-sheet-scroll');
      const [first, second] = scroll.children;
      expect(first.textContent).toContain('What are you in the mood for?');
      expect(second.classList.contains('mpp-top3')).toBe(true);
      const head = second.querySelector('.mpp-top3-head');
      expect(head.querySelector('h3').textContent).toBe('Picked for you right now');
      expect([...head.children].slice(0, 2).map((c) => c.tagName)).toEqual(['H3', 'BUTTON']);
      expect(head.querySelector('.mpp-refresh')).toBeTruthy();
      const rows = second.querySelectorAll('.mpp-row');
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.textContent).toContain('Directions');
      await click(head.querySelector('.mpp-refresh'));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('keeps the grip to a handle until the sheet is minimized, then shows the title', async () => {
      const open = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS });
      expect(open.querySelector('.mpp-sheet-grip .mpp-sheet-title')).toBeNull();
      container.remove();
      const min = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS, minimized: true });
      expect(min.querySelector('.mpp-sheet-grip .mpp-sheet-title').textContent).toBe('Picked for you right now');
    });

    it('has two states: a pull down or tap minimizes to the title, a pull up from the title opens it', async () => {
      const swipe = (el, dy) =>
        act(async () => {
          const grip = el.querySelector('.mpp-sheet-grip');
          grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
          grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 100 + dy }));
        });
      const open = { expanded: true, onExpandedChange: vi.fn(), onMinimizedChange: vi.fn() };
      let el = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS, ...open });
      await swipe(el, 60);
      expect(open.onMinimizedChange).toHaveBeenLastCalledWith(true);
      await swipe(el, 0);
      expect(open.onMinimizedChange).toHaveBeenCalledTimes(2);
      await swipe(el, -80);
      expect(open.onMinimizedChange).toHaveBeenCalledTimes(2);
      expect(open.onExpandedChange).not.toHaveBeenCalled();
      container.remove();
      const closed = { minimized: true, onExpandedChange: vi.fn(), onMinimizedChange: vi.fn() };
      el = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS, ...closed });
      await swipe(el, -80);
      expect(closed.onMinimizedChange).toHaveBeenCalledWith(false);
    });

    it('keeps the top three as rows even when expanded, and shows the distance filter inside the card', async () => {
      const el = await render({ picks: PICKS, layout: 'mood-first', moodSlot: MOODS, expanded: true, toolbar: <div data-testid="bar" /> });
      expect(el.querySelectorAll('.mpp-top3 .mpp-row')).toHaveLength(3);
      expect(el.querySelector('.mpp-top3 [data-testid="bar"]')).toBeTruthy();
      expect(el.querySelector('.mpp-card')).toBeNull();
    });

    it('shows loading rows and the lock message inside the card, without the mood cards when locked', async () => {
      const loading = await render({ picks: null, layout: 'mood-first', moodSlot: MOODS });
      expect(loading.querySelectorAll('.mpp-top3 .mpp-skeleton')).toHaveLength(3);
      container.remove();
      const locked = await render({ state: 'locked', layout: 'mood-first', moodSlot: MOODS, ratingsCount: 3 });
      expect(locked.querySelector('[data-testid="moods"]')).toBeNull();
      expect(locked.textContent).toContain('Rate 7 more places');
    });

    it('leaves the normal layout alone when no layout is asked for', async () => {
      const el = await render({ picks: PICKS });
      expect(el.querySelector('.mpp-top3')).toBeNull();
      expect(el.querySelector('.mpp-sheet-head .mpp-sheet-title')).toBeTruthy();
    });
  });

  it('shows a category tile for a place with no photo instead of a broken image', async () => {
    const el = await render({ picks: [pick('bare', { image: null }), ...PICKS] });
    const first = el.querySelector('.mpp-row');
    expect(first.querySelector('img')).toBeNull();
    expect(first.querySelector('.mpp-img-tile')).toBeTruthy();
  });

  it('new user, location off, loading, old cache and offline states', async () => {
    expect((await render({ state: 'locked' })).textContent).toContain('Rate 10 places and Mapr will start picking for you.');
    expect((await render({ state: 'no-location' })).textContent).toContain('Turn on location to see picks near you.');
    const loading = await render({ picks: null });
    expect(loading.querySelectorAll('.mpp-skeleton')).toHaveLength(3);
    expect(loading.querySelector('.mpp-card, .mpp-row:not(.mpp-skeleton)')).toBeNull();
    const old = await render({ picks: PICKS, updating: true });
    expect(old.textContent).toContain('Updating…');
    expect(old.querySelectorAll('.mpp-row')).toHaveLength(3);
    const slow = await render({ picks: PICKS, slow: true });
    expect(slow.textContent).toContain('showing your last picks');
    expect(slow.querySelectorAll('.mpp-row')).toHaveLength(3);
    const offlineEmpty = await render({ picks: null, slow: true });
    expect(offlineEmpty.textContent).toContain("You're offline");
    // No picks to be "showing" -- the message says it, the pill would lie.
    expect(offlineEmpty.querySelector('.mpp-pill-slow')).toBeNull();
  });
});

describe('PicksBottomSheet: thin or empty radius', () => {
  const places = [
    { id: 'x', region: 'miami', name: 'El Palacio', distanceMeters: 5.7 * 1609.34 },
    { id: 'y', region: 'miami', name: 'Venetian Pool', distanceMeters: 7.2 * 1609.34 },
  ];
  it('names the nearest place and offers one tap to widen', async () => {
    const onWiden = vi.fn();
    const c = await render({ picks: [], distanceMiles: 1, beyond: { places, widenTo: 10 }, onWiden });
    expect(c.textContent).toContain('Nothing within 1 mi. Nearest: El Palacio (5.7 mi).');
    const btn = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Widen to 10 mi');
    await click(btn);
    expect(onWiden).toHaveBeenCalledWith(10);
  });
  it('at the biggest chip it does not say "try a wider one"', async () => {
    const c = await render({ picks: [], distanceMiles: 100, beyond: { places: [], widenTo: null }, onWiden: () => {} });
    expect(c.textContent).toContain('Nothing to pick within 100 mi.');
    expect(c.textContent).not.toMatch(/wider/i);
    expect(c.textContent).not.toContain('Widen');
  });
  it('fewer than three picks still points past the radius', async () => {
    const c = await render({ picks: [pick('a')], distanceMiles: 1, beyond: { places, widenTo: 10 }, onWiden: () => {} });
    expect(c.textContent).toContain('Only 1 within 1 mi');
    expect(c.textContent).toContain('Widen to 10 mi');
  });
});
