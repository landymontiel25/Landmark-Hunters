// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Tutorial 2 (the First-Run Tutorial Build Guide): acceptance tests T3, T4,
// T5, T6, T7, T8 on the rendered flow, with mock GPS.
let container;
afterEach(() => {
  container?.remove();
  localStorage.clear();
  vi.resetModules();
});

async function render({ coords = null } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords, loading: false }) }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: ['food'] } }) }));
  vi.doMock('../lib/UnitsContext', async () => ({
    useUnits: () => ({ units: 'imperial' }),
    formatDistance: (await import('../lib/formatDistance')).formatDistance,
  }));
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: {} }));
  const { default: FirstRunLab } = await import('./FirstRunLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <FirstRunLab />
      </MemoryRouter>
    )
  );
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => {
  const all = [...el.querySelectorAll('button')];
  return all.find((b) => b.textContent.trim() === text) || all.find((b) => b.textContent.includes(text));
};
const wait = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)));
const events = (el) => [...el.querySelectorAll('.fr-events li code')].map((c) => c.textContent);
const chips = async (el, n) => {
  for (const c of [...el.querySelectorAll('.fr-chip')].slice(0, n)) await click(c);
};

describe('Tutorial 2 (first-run guide)', () => {
  it('T4: runs welcome to progress with one event per step, and the ring counts the rating', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const here = ALL_LANDMARKS.find((l) => l.images?.length);
    const el = await render({ coords: { lat: here.lat, lng: here.lng } });
    expect(el.textContent).toContain('Find one new place today.');
    expect(events(el)).toEqual(['first_run_shown']);

    await click(button(el, 'Show me'));
    expect(el.textContent).toContain('Pick 3 to 5.');
    await chips(el, 2);
    expect(button(el, 'Next').disabled).toBe(true);
    await click(el.querySelectorAll('.fr-chip')[2]);
    expect(button(el, 'Next').disabled).toBe(false);
    await click(button(el, 'Next'));

    // Card one has the hint; Interested asks for the one rating.
    expect(el.textContent).toContain('Swipe right if it looks good.');
    await click(button(el, 'Interested'));
    await wait(240);
    expect(el.textContent).toContain('Rate for yourself. This teaches us your taste.');
    expect(el.textContent).toContain('It was okay');
    await click(button(el, 'I loved it'));
    expect(el.textContent).not.toContain('Swipe right if it looks good.');
    await click(button(el, 'Not for me'));
    await wait(240);
    await click(button(el, 'Interested'));
    await wait(240);

    // T7: inside 30 m, Check in is on.
    expect(el.textContent).toContain("You're here.");
    await click(button(el, 'Check in'));
    expect(el.textContent).toContain('Rate 10 places and your picks get sharper.');
    expect(el.textContent).toContain('1 of 10 ratings');
    expect(el.textContent).toContain('First check-in!');
    await click(button(el, 'Done'));
    expect(el.textContent).toContain("You're set.");

    const e = events(el);
    expect(e.filter((n) => n === 'first_swipe')).toHaveLength(3);
    expect(e.filter((n) => n === 'first_rating')).toHaveLength(1);
    expect(e.filter((n) => n === 'first_checkin')).toHaveLength(1);
    expect(e.filter((n) => n === 'first_run_done')).toHaveLength(1);
    // Welcome, taste, rating, swipe, check-in, progress.
    expect(e.filter((n) => n === 'first_run_step')).toHaveLength(6);
  });

  it('T5: a fast double tap on a card fires one swipe', async () => {
    const el = await render();
    await click(button(el, 'Show me'));
    await click(button(el, 'Skip'));
    const yes = button(el, 'Not for me');
    await act(async () => {
      yes.click();
      yes.click();
    });
    await wait(240);
    expect(events(el).filter((n) => n === 'first_swipe')).toHaveLength(1);
    expect(el.textContent).toContain('2 of 3');
  });

  it('T8: outside 30 m, Check in is off, the distance shows in feet, nothing counts', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const { distanceMeters } = await import('../lib/geo');
    // About 80 m north of a place that uses the 30 m rule, with nothing else
    // within 300 m.
    const l = ALL_LANDMARKS.find(
      (a) => !a.checkInRadiusMeters && ALL_LANDMARKS.every((b) => b === a || distanceMeters(a.lat, a.lng, b.lat, b.lng) > 300)
    );
    const el = await render({ coords: { lat: l.lat + 0.0007, lng: l.lng } });
    await click(button(el, 'Show me'));
    await click(button(el, 'Skip'));
    await click(button(el, 'Skip'));
    expect(el.querySelector('.fr-pill').textContent).toMatch(/You are \d+ ft away\. Get within \d+ ft to check in\./);
    expect(button(el, 'Check in').disabled).toBe(true);
    expect(events(el)).not.toContain('first_checkin');

    // The test switch puts you at the place.
    await click(el.querySelector('.fr-toggle input'));
    expect(button(el, 'Check in').disabled).toBe(false);
  });

  it('T3: Skip on the welcome sheet ends the flow, with no first-run step left', async () => {
    const el = await render();
    await click(button(el, 'Skip'));
    expect(el.textContent).toContain('Tutorial skipped.');
    expect(events(el)).toEqual(['first_run_shown', 'first_run_step', 'first_run_done']);
    expect(el.querySelector('.fr-skipbar')).toBeNull();
  });

  it('Skip all from a step ends it too, and the sign-up prompt opens only from a trigger', async () => {
    const el = await render();
    await click(button(el, 'Show me'));
    await click(button(el, 'Skip all'));
    expect(el.textContent).toContain('Tutorial skipped.');
    expect(el.querySelector('.fr-signup')).toBeNull();
    await click(button(el, 'Sign up to keep your ratings.'));
    expect(el.querySelector('.fr-signup')).toBeTruthy();
    expect(el.textContent).toContain('Continue with Apple');
    expect(events(el)).toContain('signup_prompt');
    await click(button(el, 'Not now'));
    expect(el.querySelector('.fr-signup')).toBeNull();
  });

  it('keeps progress on this device for the account, and Restart starts over', async () => {
    let el = await render();
    await click(button(el, 'Show me'));
    expect(el.textContent).toContain('Pick 3 to 5.');
    container.remove();
    vi.resetModules();
    el = await render();
    expect(el.textContent).toContain('Pick 3 to 5.');
    await click(button(el, 'Restart'));
    expect(el.textContent).toContain('Find one new place today.');
  });
});
