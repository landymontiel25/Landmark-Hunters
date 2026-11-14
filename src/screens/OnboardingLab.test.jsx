// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

// The Test tab opens on UI; `tab: 'tutorial'` (the default here, for the
// tutorial tests) switches to the Planner tutorial bubble first.
async function renderAs(email, { nothingToTest = false, tab = 'tutorial', tabScreens = {} } = {}) {
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] } }) }));
  // The real tab screens are too heavy for these tests; a stand-in (or none,
  // which shows the tab's icon and name) takes their place.
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: tabScreens }));
  vi.doMock('./onboardingLabConfig', () => ({ NOTHING_TO_TEST: nothingToTest }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: email ? { uid: 'u', email } : null }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, loading: false }) }));
  // The UI bubble's Map screen has its own tests (MapUILab.test.jsx).
  vi.doMock('./MapUILab', () => ({ default: () => <p className="map-ui-stub">map</p> }));
  // The Landmarks tab has its own tests (LandmarkSelection.cards.test.jsx).
  vi.doMock('./LandmarkSelection', () => ({ default: ({ forMeLab }) => <p className="landmarks-stub">{forMeLab ? 'for me' : 'landmarks'}</p> }));
  // The New UI's floating header is the app's real one (Header tests cover it).
  vi.doMock('../components/Header', () => ({ default: () => <header className="header-stub" /> }));
  // Its Map tab is the app's live map (MapExplore tests cover it).
  vi.doMock('./MapExplore', () => ({ default: () => <p className="live-map-stub">map</p> }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '' }));
  const { default: OnboardingLab } = await import('./OnboardingLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<OnboardingLab />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  const bubble = tab && [...container.querySelectorAll('.lab-tabs [role="tab"]')].find((t) => t.textContent === ({ malls: 'Malls', game: 'Game tutorial' }[tab] || 'Planner tutorial'));
  if (bubble) await act(async () => bubble.click());
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
// Hello -> sign up with Google -> verify (pretend).
const signUp = async (el) => {
  await click(button(el, "Let's go"));
  await click(button(el, 'Sign up with Google'));
  await click(button(el, 'I tapped the link'));
};
// From the swipe practice into the real cards.
const toCards = async (el) => {
  await click(button(el, "Let's practice"));
  await click(button(el, 'Skip practice'));
  await click(button(el, 'Start'));
};

describe('OnboardingLab', () => {
  it('says there is nothing to test while the sandbox is switched off', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { nothingToTest: true });
    expect(el.textContent).toContain('Nothing to test');
    expect(el.textContent).not.toContain('Rate a few things you');
  });

  it('has no reset-onboarding button on the nothing-to-test page', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { nothingToTest: true });
    expect(el.textContent).toContain('Nothing to test');
    expect(el.textContent).not.toContain('Reset my onboarding');
    expect(el.textContent).not.toContain('try the update notice again');
  });

  it('opens on the UI bubble, with Rating slider and Malls next to it', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: null });
    const tabs = [...el.querySelectorAll('.lab-tabs [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['UI', 'Rating slider', 'Malls', 'Planner tutorial', 'Game tutorial', 'Official Onboarding', 'New UI', 'Itinerary tutorial', 'Taste Profile', 'Planner launch']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.uil-frame .map-ui-stub')).toBeTruthy();
  });

  it('the Rating slider bubble shows the slider', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: null });
    await click([...el.querySelectorAll('.lab-tabs [role="tab"]')].find((t) => t.textContent === 'Rating slider'));
    expect(el.querySelector('.rate-slider')).toBeTruthy();
  });

  it('the New UI bubble shows the design language screens, and the tutorials stay', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: null });
    await click([...el.querySelectorAll('.lab-tabs [role="tab"]')].find((t) => t.textContent === 'New UI'));
    expect(el.querySelector('.nui-tabbar')).toBeTruthy();
    expect(el.querySelector('.live-map-stub')).toBeTruthy();
    const names = [...el.querySelectorAll('.lab-tabs [role="tab"]')].map((t) => t.textContent);
    expect(names).toEqual(expect.arrayContaining(['Planner tutorial', 'Game tutorial', 'Official Onboarding']));
  });

  it('the Malls bubble shows the mall map', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: 'malls' });
    expect(el.querySelector('.mall-lab-map .leaflet-container')).toBeTruthy();
  });

  it('mall check-in: the real check-in sheet, plus a store dropdown; check in again for more stores', async () => {
    vi.resetModules();
    const { MallCheckIn } = await import('./MallLab.jsx');
    const { storesOfPlace, applyStoreVote, makeStoreRating, VOTE_OF_TIER } = await import('../lib/malls.js');
    const mall = { key: 'miami/dolphin-mall', id: 'dolphin-mall', regionId: 'miami', name: 'Dolphin Mall', categories: ['local-life'], topic: 'mall' };
    const stores = storesOfPlace('miami', 'dolphin-mall');
    expect(stores.length).toBeGreaterThan(5);
    let ratings = [];
    const onPost = ({ storeRatings }) => {
      let taste = { scores: {}, at: {}, counts: {} };
      const saved = storeRatings.map(({ store, rating }) => {
        taste = applyStoreVote(taste, store, VOTE_OF_TIER[rating.tier]);
        return makeStoreRating({ userId: 'u', store, vote: VOTE_OF_TIER[rating.tier], tier: rating.tier });
      });
      ratings = [...ratings, ...saved];
      return { saved, before: {}, after: taste.scores, nextRatings: ratings };
    };
    const sheet = () => (
      <MemoryRouter>
        <MallCheckIn mall={mall} stores={stores} ratings={ratings} places={stores} onPost={onPost} onClose={() => {}} />
      </MemoryRouter>
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(sheet()));
    const btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    expect(document.body.textContent).toContain('Check in to Dolphin Mall?');
    expect(btn('Post').disabled).toBe(true);
    await act(async () => btn('I loved it').click());
    expect(btn('Post').disabled).toBe(false);
    // The store dropdown: pick two.
    await act(async () => btn('Pick the stores you went into').click());
    const options = [...document.querySelectorAll('.mall-store-option')];
    await act(async () => options[0].click());
    await act(async () => options[1].click());
    await act(async () => [...document.querySelectorAll('.mall-store-picker-panel button')].find((b) => b.textContent === 'Done').click());
    const blocks = [...document.querySelectorAll('.mall-store-rating')];
    expect(blocks).toHaveLength(2);
    expect(btn('Post').disabled).toBe(true); // each picked store needs its rating
    const tierIn = (block, text) => [...block.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    await act(async () => tierIn(blocks[0], 'I loved it').click());
    await act(async () => tierIn(blocks[1], "I didn't like it").click());
    await act(async () => btn('Post').click());
    expect(document.body.textContent).toContain('Checked in!');
    expect(document.body.textContent).toContain('What Mapr learned');
    expect(ratings).toHaveLength(2);
    // Later: a new check-in at the same mall marks the stores rated before.
    await act(async () => root.render(<div />));
    await act(async () => root.render(sheet()));
    await act(async () => btn('Pick the stores you went into').click());
    expect([...document.querySelectorAll('.mall-store-option')].filter((o) => o.textContent.includes('rated before'))).toHaveLength(2);
  });

  it('runs the six mall checks on Palm Grove Plaza', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: 'malls' });
    const btn = (text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    await act(async () => btn('Run checks').click());
    expect(el.querySelectorAll('.mall-lab-checks li.pass').length).toBe(6);
  });

  it('sends non-admins away', async () => {
    const el = await renderAs('someone@example.com');
    expect(el.textContent).toContain('home');
  });

  it('shows the real tab screen, at its own path, without letting you tap it', async () => {
    const { useLocation } = await import('react-router-dom');
    function FakeItinerary() {
      return <p className="fake-screen">screen at {useLocation().pathname}</p>;
    }
    const el = await renderAs('landymontiel25@gmail.com', { tabScreens: { '/itinerary': FakeItinerary } });
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.includes('Your tabs')));
    expect(el.querySelector('.fake-screen')).toBeNull();
    await click([...el.querySelectorAll('.tut-nav-item')].find((b) => b.textContent.includes('Itinerary')));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(el.querySelector('.tut-screen .fake-screen').textContent).toBe('screen at /itinerary');
    expect(el.querySelector('.tut-screen').hasAttribute('inert')).toBe(true);
  });

  it('the Map stop can be used (tap a pin), and nothing in it leaves the tutorial', async () => {
    const { useNavigate } = await import('react-router-dom');
    function FakeMap() {
      const navigate = useNavigate();
      return (
        <div className="fake-map">
          <button type="button" className="fake-pin" onClick={() => navigate('/landmarks/miami/x')}>
            pin
          </button>
          <a className="fake-link" href="#/feed">
            feed
          </a>
        </div>
      );
    }
    const el = await renderAs('landymontiel25@gmail.com', { tabScreens: { '/': FakeMap } });
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.includes('Your tabs')));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const live = el.querySelector('.tut-screen');
    expect(live.classList.contains('live')).toBe(true);
    expect(live.hasAttribute('inert')).toBe(false);
    expect(el.textContent).toContain('Try it: tap a pin.');
    await click(el.querySelector('.fake-pin'));
    const link = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector('.fake-link').dispatchEvent(link);
    expect(link.defaultPrevented).toBe(true);
    expect(el.textContent).toContain('Tab 1 of 5');
    expect(el.textContent).not.toContain('home');
  });

  it('tapping a tab in the drawn bar jumps to it', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.includes('Your tabs')));
    await click([...el.querySelectorAll('.tut-nav-item')].find((b) => b.textContent.includes('Itinerary')));
    expect(el.querySelector('.tut-count').textContent).toContain('Itinerary');
    expect(el.textContent).toContain('Plan a trip');
  });

  it('skipping the cards right away goes on with no preference data', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await signUp(el);
    await toCards(el);
    await click(button(el, 'Skip this step'));
    expect(el.textContent).toContain('What are you into?');
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.includes('Done')));
    expect(el.textContent).toContain('no preference data yet');
  });

  it('Undo brings back the last card and drops its answer', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await signUp(el);
    await toCards(el);
    expect(button(el, 'Undo').disabled).toBe(true);
    const first = el.querySelector('.lab-card-word').textContent;
    await click(el.querySelector('[aria-label="Love it"]'));
    await act(async () => new Promise((r) => setTimeout(r, 230)));
    expect(el.querySelector('.lab-progress').textContent).toBe('3%');
    expect(el.querySelector('.lab-card-word').textContent).not.toBe(first);

    await click(button(el, 'Undo'));
    expect(el.querySelector('.lab-progress').textContent).toBe('0%');
    expect(el.querySelector('.lab-card-word').textContent).toBe(first);
    expect(button(el, 'Undo').disabled).toBe(true);
  });

  it('progressTier goes red, yellow, green, then done', async () => {
    const { progressTier } = await import('./OnboardingLab.jsx');
    expect(progressTier(0, 40)).toBe('red');
    expect(progressTier(13, 40)).toBe('red');
    expect(progressTier(14, 40)).toBe('yellow');
    expect(progressTier(26, 40)).toBe('yellow');
    expect(progressTier(27, 40)).toBe('green');
    expect(progressTier(39, 40)).toBe('green');
    expect(progressTier(40, 40)).toBe('done');
  });
});
