// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { bookingHref, costLine, timeLine } from '../lib/stopCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Each Google lookup is billed: count them.
const load = vi.fn((l, opts) => Promise.resolve(opts?.detail ? { google: null } : { google: { rating: 4.62, count: 1234 }, googleNoRating: false }));
vi.mock('../lib/landmarkRatings', () => ({ loadLandmarkRatings: (...a) => load(...a) }));
const why = vi.fn(async (stops) => Object.fromEntries(stops.map((s) => [`${s.regionId}/${s.id}`, ["I'd start here.", "You'll love the view.", "It's worth the walk."]])));
vi.mock('../lib/whyGoApi', () => ({ loadWhyGo: (...a) => why(...a), whyKey: (s) => `${s?.regionId ?? s?.region}/${s?.id}` }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));

let container;
afterEach(() => {
  container?.remove();
  load.mockClear();
  why.mockClear();
});

const STOP = { id: 'vizcaya', regionId: 'miami', name: 'Vizcaya Museum', lat: 25.74, lng: -80.21, categories: ['history-culture'], free: false, typicalMinutes: 90, images: [], summary: 'A waterfront estate with formal gardens.' };
const detailCalls = () => load.mock.calls.filter(([, o]) => o?.detail).length;

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
    expect(kids).toEqual(['it-stop-photo', 'it-stop-head', 'it-stop-desc', 'it-stop-actions', 'it-stop-more', 'it-stop-panel']);
    // The rating sits on the name's line: Google's, rounded, with its credit.
    await act(async () => {});
    expect(card.querySelector('.it-stop-head .it-stop-name').textContent).toBe('Vizcaya Museum');
    expect(card.querySelector('.it-stop-rating').textContent).toMatch(/^\u2605 4\.6Google Maps$/);
    expect(card.querySelector('.it-stop-desc').textContent).toBe('A waterfront estate with formal gardens.');
    expect([...card.querySelectorAll('.it-stop-actions > *')].map((b) => b.textContent)).toEqual(['Get directions', 'Check in', 'Book now']);
    expect(card.querySelector('.it-stop-more').textContent).toBe('Show more');
    // Nothing else: no address, no rating tag, no time tag, no trash.
    expect(card.querySelector('.route-address, .tag, .btn-icon-trash')).toBeNull();
  });

  it('loads Google reviews only when Show more opens, then lists free or cost, then the time', async () => {
    const { el, onRemove } = await render(STOP, { batch: [STOP, { ...STOP, id: 'other' }] });
    expect(detailCalls()).toBe(0);
    expect(why).not.toHaveBeenCalled();
    const more = el.querySelector('.it-stop-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(detailCalls()).toBe(1);
    expect([...el.querySelectorAll('.it-stop-facts li')].map((li) => li.textContent)).toEqual(['Costs money (needs a ticket)', 'About 1 h 30 min there']);
    // Then "Why you need to go": 3 lines, asked for the whole trip at once.
    const panel = el.querySelector('.it-stop-panel-inner');
    const order = [...panel.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('it-stop-facts')).toBe(0);
    expect(order.indexOf('it-stop-why')).toBe(1);
    expect(order[order.length - 1]).toBe('it-stop-remove');
    expect(el.querySelector('.it-stop-why h5').textContent).toBe('Why you need to go');
    expect([...el.querySelectorAll('.it-stop-why li')]).toHaveLength(3);
    expect(why).toHaveBeenCalledOnce();
    expect(why.mock.calls[0][0].map((s) => s.id)).toEqual(['vizcaya', 'other']);
    // Closing and opening again doesn't look anything up twice.
    await act(async () => more.click());
    await act(async () => more.click());
    expect(detailCalls()).toBe(1);
    expect(why).toHaveBeenCalledOnce();
    await act(async () => el.querySelector('.it-stop-remove').click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('shows "New" only when Google has no rating, and nothing when it can\'t tell', async () => {
    load.mockImplementation((l, o) => Promise.resolve(o?.detail ? { google: null } : { google: null, googleNoRating: true }));
    let { el } = await render();
    await act(async () => {});
    expect(el.querySelector('.it-stop-rating').textContent).toBe('New');
    container.remove();
    load.mockImplementation(() => Promise.resolve({ google: null, googleNoRating: false }));
    ({ el } = await render());
    await act(async () => {});
    expect(el.querySelector('.it-stop-rating').textContent).toBe('');
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

describe('every landmark in the app (owner, 2026-11-15)', () => {
  it('has a description and 3 honest "Why you need to go" lines, in Mapr\'s voice', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const { descriptionLine, fallbackWhy } = await import('../lib/stopCard');
    expect(ALL_LANDMARKS.length).toBeGreaterThan(1000);
    for (const l of [...ALL_LANDMARKS, { external: true, name: 'Found', address: '1 Main St' }, { categories: ['food'] }]) {
      const d = descriptionLine(l);
      expect(d.length, l.id).toBeGreaterThan(3);
      const why = fallbackWhy(l);
      expect(why).toHaveLength(3);
      // The description is the place's real summary, so a sourced figure
      // (Loudcloud's "$1.65 billion sale") stays; Mapr's own lines never
      // mention money.
      for (const line of why) expect(line).not.toMatch(/\$/);
      for (const line of [d, ...why]) {
        expect(line).not.toMatch(/[—–]|Mapr /);
        expect(line).not.toMatch(/\b(I am|You are|It is|I will|You will|do not|is not)\b/);
      }
    }
  });
});
