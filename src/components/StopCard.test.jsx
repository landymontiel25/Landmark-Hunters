// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { costLine, timeLine } from '../lib/stopCard';

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
  it('shows only the photo, the name, Get directions, Check in and Info, and Show more, in that order', async () => {
    const { el } = await render();
    const card = el.querySelector('.it-stop');
    const kids = [...card.children].map((c) => c.className.split(' ')[0]);
    expect(kids).toEqual(['it-stop-photo', 'it-stop-head', 'it-stop-desc', 'it-stop-actions', 'it-stop-more', 'it-stop-panel']);
    // The rating sits on the name's line: Google's, rounded, with its credit.
    await act(async () => {});
    expect(card.querySelector('.it-stop-head .it-stop-name').textContent).toBe('Vizcaya Museum');
    expect(card.querySelector('.it-stop-rating').textContent).toMatch(/^\u2605 4\.6Google Maps$/);
    expect(card.querySelector('.it-stop-desc').textContent).toBe('A waterfront estate with formal gardens.');
    // No Book now (owner, 2026-11-16).
    expect([...card.querySelectorAll('.it-stop-actions > *')].map((b) => b.textContent)).toEqual(['Get directions', 'Check in', 'Info']);
    expect(card.textContent).not.toContain('Book now');
    expect(card.querySelector('.it-stop-more').textContent).toBe('Show more');
    // Nothing else: no address, no rating tag, no time tag, no trash.
    expect(card.querySelector('.route-address, .tag, .btn-icon-trash')).toBeNull();
  });

  it('loads Google reviews only when Show more opens, then lists Free / Needs a ticket, then Time Spent', async () => {
    const { el, onRemove } = await render(STOP, { batch: [STOP, { ...STOP, id: 'other' }] });
    expect(detailCalls()).toBe(0);
    expect(why).not.toHaveBeenCalled();
    const more = el.querySelector('.it-stop-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(detailCalls()).toBe(1);
    expect([...el.querySelectorAll('.it-stop-facts li')].map((li) => li.textContent)).toEqual(['Needs a ticket', 'Time Spent: ~1 hr 30 min']);
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

  it('says Free or Needs a ticket, never "costs money" or a price, and Time Spent: ~x', () => {
    expect(costLine({ free: true })).toBe('Free');
    expect(costLine({ free: false })).toBe('Needs a ticket');
    expect(costLine({ categories: ['food'] })).toBe('No ticket needed');
    expect(costLine({})).toBe('Might need a ticket');
    for (const s of [costLine({}), costLine({ free: false }), costLine({ categories: ['food'] })]) expect(s).not.toMatch(/costs? money|\$/i);
    expect(timeLine({ typicalMinutes: 45 })).toBe('Time Spent: ~45 min');
    expect(timeLine({ typicalMinutes: 120 })).toBe('Time Spent: ~2 hr');
    expect(timeLine({ typicalMinutes: 90 })).toBe('Time Spent: ~1 hr 30 min');
    expect(timeLine({})).toBeNull();
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

describe('StopCard Info button and Why you need to go star (owner, 2026-11-19)', () => {
  it('opens the place from Info, and the heading has an icon, not an emoji', async () => {
    const onOpen = vi.fn();
    const { el } = await render(STOP, { onOpen });
    const info = [...el.querySelectorAll('.it-stop-actions button')].find((b) => b.textContent === 'Info');
    await act(async () => info.click());
    expect(onOpen).toHaveBeenCalled();
    await act(async () => el.querySelector('.it-stop-more').click());
    const h5 = el.querySelector('.it-stop-why h5');
    expect(h5.querySelector('svg')).toBeTruthy();
    expect(h5.textContent.trim()).toBe('Why you need to go');
  });
});

describe('StopCard Show more order, icons and the add list (owner, 2026-11-19)', () => {
  const MISSION_STOP = { ...STOP, mission: { type: 'photo', text: 'Photograph the gardens.' } };
  it('puts "Why you need to go" before Mission, each with an icon', async () => {
    const { el } = await render(MISSION_STOP);
    await act(async () => el.querySelector('.it-stop-more').click());
    const inner = el.querySelector('.it-stop-panel-inner');
    const why = inner.querySelector('.it-stop-why');
    const mission = inner.querySelector('.it-stop-mission');
    expect(why.compareDocumentPosition(mission) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mission.querySelector('h5 svg')).toBeTruthy();
    expect(mission.querySelector('h5').textContent.trim()).toBe('Mission:');
    expect(why.querySelector('h5 svg')).toBeTruthy();
  });

  it('shows no "Remove from trip" for a place that is not on the trip (no onRemove)', async () => {
    const { el } = await render(STOP, { onRemove: undefined });
    await act(async () => el.querySelector('.it-stop-more').click());
    expect(el.querySelector('.it-stop-remove')).toBeNull();
  });
});
