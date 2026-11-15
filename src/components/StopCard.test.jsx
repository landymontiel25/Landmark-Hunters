// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { bookingHref, costLine, timeLine } from '../lib/stopCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Each Google lookup is billed: count them.
const load = vi.fn(() => Promise.resolve({ google: null }));
vi.mock('../lib/landmarkRatings', () => ({ loadLandmarkRatings: (...a) => load(...a) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));

let container;
afterEach(() => {
  container?.remove();
  load.mockClear();
});

const STOP = { id: 'vizcaya', regionId: 'miami', name: 'Vizcaya Museum', lat: 25.74, lng: -80.21, categories: ['history-culture'], free: false, typicalMinutes: 90, images: [] };

async function render(stop = STOP, props = {}) {
  const { default: StopCard } = await import('./StopCard.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const onRemove = vi.fn();
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <StopCard stop={stop} onOpen={() => {}} onRemove={onRemove} checkIn={{ user: { uid: 'u' }, firebaseEnabled: true, claimedMap: {}, checkingIn: null, onCheckIn: () => {} }} {...props} />
      </MemoryRouter>,
    ),
  );
  return { el: container, onRemove };
}

describe('Itinerary stop card (owner, 2026-11-14)', () => {
  it('shows only the photo, the name, the three buttons and Show more, in that order', async () => {
    const { el } = await render();
    const card = el.querySelector('.it-stop');
    const kids = [...card.children].map((c) => c.className.split(' ')[0]);
    expect(kids).toEqual(['it-stop-photo', 'it-stop-name', 'it-stop-actions', 'it-stop-more', 'it-stop-panel']);
    expect([...card.querySelectorAll('.it-stop-actions > *')].map((b) => b.textContent)).toEqual(['Get directions', 'Check in', 'Book now']);
    expect(card.querySelector('.it-stop-more').textContent).toBe('Show more');
    // Nothing else: no address, no rating tag, no time tag, no trash.
    expect(card.querySelector('.route-address, .tag, .btn-icon-trash')).toBeNull();
  });

  it('loads Google reviews only when Show more opens, then lists free or cost, then the time', async () => {
    const { el, onRemove } = await render();
    expect(load).not.toHaveBeenCalled();
    const more = el.querySelector('.it-stop-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(load).toHaveBeenCalledOnce();
    expect([...el.querySelectorAll('.it-stop-facts li')].map((li) => li.textContent)).toEqual(['Costs money (needs a ticket)', 'About 1 h 30 min there']);
    // Closing and opening again doesn't look them up twice.
    await act(async () => more.click());
    await act(async () => more.click());
    expect(load).toHaveBeenCalledOnce();
    await act(async () => el.querySelector('.it-stop-remove').click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('says free or costs money, never a price, and books only what can be booked', () => {
    expect(costLine({ free: true })).toBe('Free to visit');
    expect(costLine({ free: false })).toBe('Costs money (needs a ticket)');
    expect(costLine({ categories: ['food'] })).toBe('Costs money (you pay for what you order)');
    expect(costLine({})).toBe('Might cost money. Check before you go.');
    expect(timeLine({ typicalMinutes: 45 })).toBe('About 45 min there');
    expect(timeLine({})).toBeNull();
    expect(bookingHref({ name: 'Park', free: true })).toBeNull();
    expect(bookingHref({ name: 'Zoo', free: false })).toContain('Zoo%20tickets');
    expect(bookingHref({ name: 'Joe', categories: ['food'] })).toContain('Joe%20reservation');
    expect(bookingHref({ name: 'X', bookingUrl: 'https://x.test' })).toBe('https://x.test');
    for (const s of [costLine({}), costLine({ categories: ['food'] })]) expect(s).not.toMatch(/\$|—/);
  });
});
