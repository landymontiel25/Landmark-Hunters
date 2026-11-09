// @vitest-environment jsdom
// The Landmarks tab after the 2026-11-06 change: Landmarks | Neighborhoods
// subtabs, landmark cards two to a row with every field and button they had,
// and For Me moved to the Test tab (LandmarkSelection forMeLab).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let el;
afterEach(() => {
  el?.remove();
  vi.resetModules();
});

const checkIn = vi.fn();
const toggleLandmark = vi.fn();

async function renderIt({ props = {}, ratings = {} } = {}) {
  vi.doMock('../lib/TripContext', () => ({
    useTrip: () => ({
      isSavedForLater: () => false,
      trip: { activeRegion: 'villanova', customInterests: [], customInterestMatches: {}, customInterestEmoji: {}, savedInterests: [], byRegion: {} },
      toggleLandmark,
      getRegionSelection: () => [],
      regionsWithItineraries: () => [],
      clearRegion: vi.fn(),
      clearAll: vi.fn(),
      updateTrip: vi.fn(),
      setMapFocus: vi.fn(),
      setCustomInterestMatches: vi.fn(),
      setCustomInterestEmoji: vi.fn(),
    }),
  }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, refresh: vi.fn(), refreshing: false }) }));
  vi.doMock('../lib/useCheckIn', () => ({
    useCheckIn: () => ({ user: { uid: 'me', email: 'me@x.com' }, firebaseEnabled: true, claimedMap: {}, checkingIn: null, checkIn }),
  }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me', email: 'me@x.com' }, firebaseEnabled: true }) }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ ratings, myReviews: {}, reload: () => Promise.resolve() }) }));
  vi.doMock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ myPhotos: {} }) }));
  vi.doMock('../lib/LandmarkEditsContext', () => ({ useLandmarkEdits: () => ({ applyEdit: (l) => l }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '' }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: null }) }));
  // Network-backed pieces: Google's ratings and the save sheet.
  vi.doMock('../lib/useTopRatings', () => ({ useTopRatings: () => ({ ready: true, google: {}, live: {} }) }));
  vi.doMock('../lib/usePageRatings', () => ({ usePageRatings: () => ({}), ratingKey: (l) => l.id }));
  vi.doMock('../lib/maprRank/modelStore.js', () => ({ loadMaprModels: () => new Promise(() => {}) }));
  vi.doMock('../components/ratings/RatingsCardLine', () => ({ default: () => <span className="tag google-line">Google</span> }));
  vi.doMock('../components/SaveLandmarkButton', () => ({ default: () => <button type="button" className="share-icon-btn" aria-label="Save" /> }));
  vi.doMock('../lib/customLandmarks', () => ({ getCustomLandmarks: () => Promise.resolve([]) }));
  const { default: LandmarkSelection } = await import('./LandmarkSelection.jsx');
  el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () =>
    createRoot(el).render(
      <MemoryRouter>
        <LandmarkSelection {...props} />
      </MemoryRouter>
    )
  );
  return el;
}

const buttons = (text) => [...el.querySelectorAll('button')].filter((b) => b.textContent.includes(text));

describe('Landmarks tab', () => {
  it('opens on the Landmarks subtab, and Neighborhoods swaps in the new screen', async () => {
    await renderIt();
    const tabs = [...el.querySelectorAll('.lm-subtab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Landmarks', 'Neighborhoods']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('.landmark-row').length).toBe(25);
    await act(async () => tabs[1].click());
    expect(el.querySelector('.nb-title').textContent).toBe('Explore Neighborhoods');
    expect(el.querySelector('.landmark-row')).toBeNull();
    await act(async () => el.querySelectorAll('.lm-subtab')[0].click());
    expect(el.querySelectorAll('.landmark-row').length).toBe(25);
  }, 60000);

  it('has no For Me sort any more', async () => {
    await renderIt();
    expect(el.querySelector('.lm-sort-tabs').textContent).not.toContain('For Me');
    expect(el.querySelector('.lm-sort-tabs').textContent).toContain('Popular Landmarks');
    expect(el.querySelector('.lm-sort-tabs').textContent).toContain('Near Me');
  }, 60000);

  it('the Popular button names the category picked (owner, 2026-11-08)', async () => {
    await renderIt();
    const popular = () => el.querySelector('.lm-sort-tabs .tab-btn').textContent;
    const cat = (id) => el.querySelector(`.lm-category-tabs [data-cat="${id}"]`);
    expect(popular()).toContain('Popular Landmarks');
    await act(async () => cat('local-life').click());
    expect(popular()).toContain('Popular Nightlife');
    await act(async () => cat('local-life').click());
    await act(async () => cat('food').click());
    expect(popular()).toContain('Popular Restaurants');
    await act(async () => cat('history-culture').click());
    expect(popular()).toContain('Popular Places');
    await act(async () => cat('food').click());
    await act(async () => cat('history-culture').click());
    expect(popular()).toContain('Popular Landmarks');
  }, 60000);

  it('opens with no sort picked; a category tap picks Popular (owner, 2026-11-08)', async () => {
    await renderIt();
    expect(el.querySelector('.lm-sort-tabs .tab-btn.active')).toBeNull();
    await act(async () => el.querySelector('.lm-category-tabs [data-cat="food"]').click());
    expect(el.querySelector('.lm-sort-tabs .tab-btn.active').textContent).toContain('Popular Restaurants');
  }, 60000);

  it('rows keep the place photo, every field and button, with a "..." menu (owner, 2026-11-09)', async () => {
    await renderIt();
    const card = el.querySelector('.nb-grid .landmark-row.lm-card');
    expect(card).toBeTruthy();
    const photo = card.querySelector('.lm-card-photo');
    expect(photo.compareDocumentPosition(card.querySelector('h4')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(photo.querySelector('.check-circle[role="checkbox"]')).toBeTruthy();
    // The photo (or the category tile) is the row's image, not a small circle.
    expect(photo.querySelector('.landmark-thumb, .landmark-thumb-fallback, img')).toBeTruthy();
    expect(photo.querySelector('.lm-card-icon')).toBeNull();
    // Save and Share sit behind the "..." on the right of the row.
    expect(card.querySelector('[aria-label="Save"]')).toBeNull();
    await act(async () => card.querySelector('.lm-card-more').click());
    expect(card.querySelector('.lm-card-menu [aria-label="Save"]')).toBeTruthy();
    expect(card.querySelector('.quick-rate-btn')).toBeTruthy();
    expect(card.querySelector('.google-line')).toBeTruthy();
    expect(card.querySelector('.lr-category-icons')).toBeTruthy();
    const actions = [...card.querySelectorAll('.lr-actions button')].map((b) => b.textContent);
    expect(actions[0]).toBe('Info');
    expect(actions.some((t) => t.includes('Directions'))).toBe(true);
    expect(actions.some((t) => t.includes('Check In'))).toBe(true);
  }, 60000);

  it('Check In still checks in the landmark on that card', async () => {
    checkIn.mockClear();
    await renderIt();
    const card = el.querySelector('.landmark-row');
    const name = card.querySelector('h4').textContent;
    const btn = [...card.querySelectorAll('.lr-actions button')].find((b) => b.textContent.includes('Check In'));
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(name).toContain(checkIn.mock.calls[0][0].name);
  }, 60000);

  it('the rate button and the itinerary circle still work from a card', async () => {
    toggleLandmark.mockClear();
    await renderIt();
    const card = el.querySelector('.landmark-row');
    await act(async () => card.querySelector('.check-circle').click());
    expect(toggleLandmark).toHaveBeenCalledTimes(1);
    await act(async () => card.querySelector('.quick-rate-btn').click());
    expect(document.body.querySelector('.modal-card')).toBeTruthy();
  }, 60000);

  it('never shows the app\'s own rating on a card (owner, 2026-11-08: Google only)', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const ratings = Object.fromEntries(ALL_LANDMARKS.map((l) => [l.id, { avg: 4.2, count: 3 }]));
    await renderIt({ ratings });
    expect(el.querySelector('.lm-card-badge')).toBeNull();
    expect(el.textContent).not.toContain('4.2 (3)');
  }, 60000);

  it('For Me on the Test tab: the same list, For Me locked on, no subtabs', async () => {
    await renderIt({ props: { forMeLab: true } });
    expect(el.querySelector('.lm-subtabs')).toBeNull();
    expect(el.querySelector('.screen-title').textContent).toContain('For Me');
    const sorts = [...el.querySelectorAll('.lm-sort-tabs .tab-btn')].map((b) => b.textContent);
    expect(sorts[0]).toContain('For Me');
    expect(sorts.join(' ')).not.toContain('Popular Landmarks');
    expect(el.querySelector('.lm-sort-tabs .tab-btn.active').textContent).toContain('For Me');
    expect(el.querySelectorAll('.landmark-row').length).toBe(25);
    expect(buttons('Check In').length).toBeGreaterThan(0);
  }, 60000);
});
