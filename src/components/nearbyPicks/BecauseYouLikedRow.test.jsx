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
// Photos are "ready" at once, so the row renders without waiting on images.
vi.mock('./useNearbyPicks', () => ({ useReadyItems: (items, limit) => (items || []).slice(0, limit) }));

import BecauseYouLikedRow from './BecauseYouLikedRow';

const place = (id) => ({ id, region: 'philly', name: `Place ${id}`, image: null, categories: ['food'], distanceMeters: 500, lat: 40, lng: -75 });
const liked = { name: 'Reading Terminal Market' };

let container;
let root;
beforeEach(() => {
  h.save.mockReset();
  h.save.mockImplementation(async ({ landmark, verdict }) => ({ status: 'saved', entry: { landmarkId: landmark.id, verdict } }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <BecauseYouLikedRow liked={liked} places={['a', 'b'].map(place)} {...props} />
      </MemoryRouter>
    )
  );
};
const group = (name) => container.querySelector(`[aria-label="Would you go to ${name}?"]`);

describe('BecauseYouLikedRow votes', () => {
  it('asks "Would you go?" on every card when signed in', async () => {
    await render({ uid: 'u1' });
    expect(group('Place a')).toBeTruthy();
    expect(group('Place b')).toBeTruthy();
    expect([...group('Place a').querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['✕ Not for me', '🤷 Not sure', "✓ I'd go"]);
  });

  it('saves the answer, and "Not for me" takes the card out', async () => {
    await render({ uid: 'u1' });
    await act(async () => group('Place a').querySelector('.pick-vote-btn.hate').click());
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'no', landmark: expect.objectContaining({ id: 'a' }) }));
    expect(group('Place a')).toBeNull();
    expect(group('Place b')).toBeTruthy();
  });

  it('shows no buttons when signed out', async () => {
    await render({ uid: null });
    expect(group('Place a')).toBeNull();
    expect(container.textContent).toContain('Because you liked Reading Terminal Market');
  });
});
