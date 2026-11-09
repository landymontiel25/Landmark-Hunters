// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let el;
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  vi.resetModules();
});

async function render(stats, reviews) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, firebaseEnabled: true }) }));
  vi.doMock('../lib/BadgesContext', () => ({ useBadges: () => ({ stats }) }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: reviews }) }));
  vi.doMock('../lib/soloStreaks', () => ({ subscribeMySoloStreak: () => () => {} }));
  const { default: MyStatTiles } = await import('./MyStatTiles');
  el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(
      <MemoryRouter>
        <MyStatTiles />
      </MemoryRouter>
    );
  });
  return el;
}

describe('MyStatTiles', () => {
  it('shows check-ins, cities, streak and rated from the real data', async () => {
    const out = await render({ checkins: 42, cities: 3, cityIds: ['a'] }, { x: { ratingTier: 'love' }, y: { ratingTier: 'ok' }, z: { stars: 4 } });
    const text = [...out.querySelectorAll('.profile-stat')].map((t) => t.textContent);
    expect(text).toHaveLength(4);
    expect(text[0]).toContain('42');
    expect(text[0]).toContain('check-ins');
    expect(text[1]).toContain('3');
    expect(text[2]).toContain('streak');
    // Only tier ratings count: 2 of the 3 reviews.
    expect(text[3]).toMatch(/^2\/\d+rated$/);
  });
});
