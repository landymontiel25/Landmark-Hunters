// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';

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
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<PicksBottomSheet expanded={false} onExpandedChange={() => {}} {...props} />} />
          <Route path="/landmarks/:region/:id" element={<LandmarkPage />} />
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

  it('tapping an expanded card opens the same choices', async () => {
    const el = await render({ picks: PICKS, expanded: true });
    await click(el.querySelectorAll('.mpp-card-main')[1]);
    expect(document.querySelector('.modal-card').textContent).toContain('Place b');
    await click(sheetButton('Open landmark page'));
    expect(el.textContent).toContain('landmark page villanova/b');
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
    expect((await render({ picks: null, slow: true })).textContent).toContain("You're offline");
  });
});
