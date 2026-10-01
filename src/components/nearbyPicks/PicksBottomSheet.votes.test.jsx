// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/UnitsContext', () => ({
  useUnits: () => ({ units: 'imperial' }),
  formatDistance: (m) => `${(m / 1609.34).toFixed(1)} mi`,
}));
vi.mock('../../lib/pickFeedback', () => ({
  getPickFeedback: async () => ({}),
  readPendingPickVotes: () => ({}),
  flushPendingPickVotes: async () => [],
  setPickFeedback: (...a) => h.save(...a),
}));

import PicksBottomSheet from './PicksBottomSheet';

const pick = (id) => ({ id, region: 'villanova', name: `Place ${id}`, image: `https://img.example/${id}.jpg`, categories: ['food'], distanceMeters: 800, pickType: 'usual', reason: `Reason ${id}`, lat: 40, lng: -75 });
const PICKS = ['a', 'b', 'c', 'd'].map(pick);

let container;
let root;
let onShown;
beforeEach(() => {
  h.save.mockReset();
  h.save.mockImplementation(async ({ landmark, verdict }) => ({ status: 'saved', entry: { landmarkId: landmark.id, verdict } }));
  onShown = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = async (props = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <PicksBottomSheet picks={PICKS} uid="u1" expanded={false} onExpandedChange={() => {}} onShown={onShown} {...props} />
      </MemoryRouter>
    )
  );
};
const group = (name) => container.querySelector(`[aria-label="Would you go to ${name}?"]`);
const btn = (name, label) => [...group(name).querySelectorAll('button')].find((b) => b.textContent.includes(label));
const tap = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('Map sheet pick buttons', () => {
  it('shows Not for me, Not sure and I\'d go on every collapsed row', async () => {
    await render();
    for (const n of ['Place a', 'Place b', 'Place c']) {
      expect([...group(n).querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['✕ Not for me', '\u{1F937} Not sure', "✓ I'd go"]);
    }
    expect(group('Place d')).toBeNull();
    expect(container.textContent.toLowerCase()).not.toContain('ask me again');
    // the Directions / open-landmark actions are still there
    expect(container.querySelectorAll('.mpp-row-main')).toHaveLength(3);
  });

  it('shows them on the expanded cards too, next to Directions', async () => {
    await render({ expanded: true });
    expect(container.querySelectorAll('.mpp-card')).toHaveLength(4);
    for (const card of container.querySelectorAll('.mpp-card')) {
      expect(card.querySelectorAll('.pick-vote-btn')).toHaveLength(3);
      expect(card.textContent).toContain('Directions');
    }
  });

  it('has no buttons when signed out (no uid)', async () => {
    await render({ uid: null });
    expect(container.querySelector('.pick-vote-btn')).toBeNull();
  });

  it('Not for me removes the card, the next pick fills the slot and is logged as shown with its set rank', async () => {
    await render();
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(onShown.mock.calls[0][0].map((p) => [p.id, p.rank])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    await tap(btn('Place a', 'Not for me'));
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', verdict: 'no', landmark: expect.objectContaining({ id: 'a', region: 'villanova' }) }));
    expect(group('Place a')).toBeNull();
    expect([...container.querySelectorAll('.mpp-row')].map((r) => r.querySelector('strong').textContent)).toEqual(['Place b', 'Place c', 'Place d']);
    const last = onShown.mock.calls.at(-1)[0];
    expect(last.map((p) => [p.id, p.rank])).toEqual([['b', 2], ['c', 3], ['d', 4]]);
  });

  it("I'd go and Not sure keep the card, shown as selected, and a tap on another button changes the answer", async () => {
    await render();
    await tap(btn('Place a', "I'd go"));
    expect(btn('Place a', "I'd go").getAttribute('aria-pressed')).toBe('true');
    await tap(btn('Place b', 'Not sure'));
    expect(btn('Place b', 'Not sure').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.mpp-row')).toHaveLength(3);
    await tap(btn('Place a', 'Not sure'));
    expect(btn('Place a', 'Not sure').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Place a', "I'd go").getAttribute('aria-pressed')).toBe('false');
  });

  it('saves first: nothing is selected or removed until the save lands', async () => {
    let done;
    h.save.mockImplementation(() => new Promise((r) => (done = r)));
    await render();
    await tap(btn('Place a', 'Not for me'));
    expect(group('Place a')).not.toBeNull();
    expect(container.textContent).toContain('Saving');
    await act(async () => done({ status: 'saved', entry: { landmarkId: 'a', verdict: 'no' } }));
    expect(group('Place a')).toBeNull();
  });

  it('a failed save shows an error and Try again; the card stays until it saves', async () => {
    h.save.mockRejectedValueOnce(new Error('down'));
    await render();
    await tap(btn('Place a', 'Not for me'));
    expect(group('Place a')).not.toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toContain("Couldn't save");
    await tap(alert.querySelector('button'));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(group('Place a')).toBeNull();
  });

  it('offline: shows "Not saved yet" and does not select or remove', async () => {
    h.save.mockResolvedValueOnce({ status: 'pending', entry: { landmarkId: 'a', verdict: 'no' } });
    await render();
    await tap(btn('Place a', 'Not for me'));
    expect(container.textContent).toContain('Not saved yet');
    expect(group('Place a')).not.toBeNull();
    expect(btn('Place a', 'Not for me').getAttribute('aria-pressed')).toBe('false');
  });
});
