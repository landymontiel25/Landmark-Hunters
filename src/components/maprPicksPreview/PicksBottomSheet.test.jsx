// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

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
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <PicksBottomSheet expanded={false} onExpandedChange={() => {}} {...props} />
      </MemoryRouter>
    )
  );
  return container;
};

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

  it('swipe up expands, swipe down collapses', async () => {
    const onExpandedChange = vi.fn();
    const el = await render({ picks: PICKS, onExpandedChange });
    const grip = el.querySelector('.mpp-sheet-grip');
    const swipe = (from, to) =>
      act(async () => {
        grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: from }));
        grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: to }));
      });
    await swipe(400, 300);
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    await swipe(300, 400);
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it('new user, location off, loading, old cache and slow signal states', async () => {
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
  });
});
