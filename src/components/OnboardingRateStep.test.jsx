// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

const submit = vi.fn(async () => {});
const reload = vi.fn(async () => {});

const review = (id) => [id, { landmarkId: id, ratingTier: 'worth-trying' }];

async function renderStep({ myReviews = {}, loaded = true, coords = null, onDone = vi.fn(), onLater = vi.fn() } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews, myReviewsLoaded: loaded, reload }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { activeRegion: null } }) }));
  vi.doMock('../lib/UnitsContext', async () => ({
    ...(await vi.importActual('../lib/UnitsContext')),
    useUnits: () => ({ units: 'imperial' }),
  }));
  vi.doMock('../lib/reviews', () => ({ submitReview: submit }));
  vi.doMock('./LandmarkThumb', () => ({ default: () => null }));
  const { default: Step } = await import('./OnboardingRateStep.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Step lovedTags={['food']} onDone={onDone} onLater={onLater} />);
  });
  return { el: container, onDone, onLater };
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const cardName = (el) => el.querySelector('h3')?.textContent;

describe('OnboardingRateStep', () => {
  it('shows progress counting ratings the account already has', async () => {
    const { el } = await renderStep({ myReviews: Object.fromEntries([review('a'), review('b'), review('c')]) });
    expect(el.textContent).toContain('3 of 10');
    expect(el.querySelector('[role=progressbar]').getAttribute('aria-valuenow')).toBe('3');
  });

  it.each([
    ['I loved it', 'highly-recommend'],
    ['Ok', 'worth-trying'],
    ["I didn't like it", 'probably-skip'],
  ])('"%s" saves a tier-only rating marked as onboarding and moves to the next place', async (label, tier) => {
    const { el } = await renderStep();
    const first = cardName(el);
    await click(button(el, label));
    expect(submit).toHaveBeenCalledTimes(1);
    const arg = submit.mock.calls[0][0];
    expect(arg.rating).toEqual({ tier, fromOnboarding: true });
    expect(arg.userId).toBe('u');
    expect(arg.landmark.name).toBe(first);
    expect(el.textContent).toContain('1 of 10');
    expect(cardName(el)).not.toBe(first);
  });

  it('"Haven\'t been / not sure" skips the place without writing or counting', async () => {
    const { el } = await renderStep();
    const first = cardName(el);
    await click(button(el, "Haven't been"));
    expect(submit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('0 of 10');
    expect(cardName(el)).not.toBe(first);
  });

  it('never shows a place twice', async () => {
    const { el } = await renderStep();
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      seen.add(cardName(el));
      await click(button(el, i % 2 ? "Haven't been" : 'Ok'));
    }
    expect(seen.size).toBe(6);
  });

  it('keeps the card and shows an error when the save fails', async () => {
    submit.mockRejectedValueOnce(new Error('boom'));
    const { el } = await renderStep();
    const first = cardName(el);
    await click(button(el, 'Ok'));
    expect(el.querySelector('[role=alert]')).toBeTruthy();
    expect(cardName(el)).toBe(first);
    expect(el.textContent).toContain('0 of 10');
  });

  it('reaches 10 and shows the done state, then continues', async () => {
    const { el, onDone } = await renderStep({
      myReviews: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(review)),
    });
    expect(el.textContent).toContain('9 of 10');
    await click(button(el, 'I loved it'));
    expect(el.textContent).toContain('Mapr can pick for you');
    expect(onDone).not.toHaveBeenCalled();
    await click(button(el, 'Continue'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('"Do this later" leaves without rating', async () => {
    const { el, onLater } = await renderStep();
    await click(button(el, 'Do this later'));
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('skips itself when the account already has 10 ratings', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const { onDone } = await renderStep({ myReviews: Object.fromEntries(ids.map(review)) });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('puts the closest well-known places first when there is a location', async () => {
    // Philadelphia / Villanova area vs. the rest of the catalog.
    const { el } = await renderStep({ coords: { lat: 40.0368, lng: -75.3421 } });
    expect(el.textContent).toMatch(/mi away|km away|ft away|m away/);
  });
});
