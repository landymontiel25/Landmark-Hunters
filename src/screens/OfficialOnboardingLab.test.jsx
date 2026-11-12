// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { answersFromCats, buildDay, cityById, cityCategories, CITIES, reflectLine, lighterDay } from './officialOnboardingSteps';
import { PITCHES, pitchFor } from './officialOnboardingPitches';
import { ALL_LANDMARKS } from '../data/regions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render() {
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: {} }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c' } }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, loading: false }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: (m) => `${Math.round(m)} m` }));
  const { default: OfficialOnboardingLab } = await import('./OfficialOnboardingLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <OfficialOnboardingLab />
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const bubbles = (el) => [...el.querySelectorAll('.mapr-bubble')].map((b) => b.textContent).join(' ');
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('Official Onboarding (Test tab)', () => {
  it("lists the owner's 9 steps in order, with the shared controls", async () => {
    const el = await render();
    expect([...el.querySelectorAll('.lab-step')].map((b) => b.textContent)).toEqual([
      '1. Problem + solution',
      '2. City',
      '3. Taste pick',
      '4. Categories',
      '5. Reflection',
      '6. First Mapr pick',
      '7. First check-in',
      '8. Summary',
      '9. Sign up',
    ]);
    expect(el.textContent).toContain('Nothing here is saved');
    for (const b of ['Restart', 'Back', 'Next step']) expect(button(el, b)).toBeTruthy();
    expect(el.textContent).toContain("Pretend I'm at the place");
    expect(el.querySelector('.mapr-bubble-face').textContent).toBe('\u{1F9E0}');
  });

  it('walks the whole flow: no sign-up before step 9, 10 ratings jump on, check-in +100, summary', async () => {
    const el = await render();
    await click(el.querySelector('.fr-toggle input'));
    const next = () => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next \u{2192}');
    expect(bubbles(el)).toContain('Hi, I’m Mapr, your personal travel planner and guide. Together, we’ll create a trip built around you—your interests, your time, and your sense of adventure. Let\'s do it!');
    await click(next());
    expect(bubbles(el)).toContain('tourist traps');
    await click(next());
    expect(bubbles(el)).toContain("Mapr builds your day from what you like.");
    await click(button(el, "Let's build my day"));

    expect(bubbles(el)).toContain('Where are you exploring?');
    for (const c of ['Miami', 'Villanova / Philly', 'Milan / Monza', 'Lake Como', 'Pick another city']) expect(button(el, c)).toBeTruthy();
    await click(button(el, 'Miami'));
    await click(next());

    expect(bubbles(el)).toContain('Pick 3 to 5 kinds of places');
    expect(bubbles(el)).not.toContain("Skip and I'll guess");
    expect(button(el, 'Skip for now')).toBeTruthy();
    expect(next().disabled).toBe(true);
    await click(button(el, 'Food'));
    await click(button(el, 'Parks & Nature'));
    expect(next().disabled).toBe(true);
    await click(button(el, 'Art & Culture'));
    expect(next().disabled).toBe(false);
    await click(next());

    // Categories instead of rating 10 places: every category with places in
    // Miami, icons and all, starting from the three picked a step ago.
    expect(bubbles(el)).toContain("Categories you'd like to visit.");
    expect(el.textContent).not.toContain('Rate 10');
    expect(el.querySelector('.lab-card')).toBeNull();
    expect(el.textContent).not.toContain('Sign up with Google');
    expect(el.textContent).toContain('3 picked');
    const tile = (name) => [...el.querySelectorAll('.oo-cat')].find((b) => b.querySelector('.oo-cat-name').textContent === name);
    expect(tile('Food').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Shopping').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Food').querySelector('.oo-cat-icon').textContent).not.toBe('');
    await click(tile('Shopping'));
    expect(el.textContent).toContain('4 picked');
    expect(el.textContent).toContain('+10 Shopping');
    await click(tile('Shopping'));
    expect(el.textContent).toContain('3 picked');
    await click(next());

    // Mapr repeats the picks back.
    expect(bubbles(el)).toContain('Okay — you want food, parks & nature and art & culture. Got it.');
    expect(bubbles(el)).toContain("Anything else you love or hate that the cards didn't cover?");
    await act(async () => {
      const t = el.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'No chains please');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(el, 'Save & build my day'));

    expect(bubbles(el)).toMatch(/Your Miami day: 1\. .+ → 2\. .+ → 3\. .+\. 3 stops · /);
    expect(el.querySelector('.intro-map')).toBeTruthy();
    expect(el.textContent).toContain('How long it takes');
    await click(button(el, 'Save this day'));

    // Location primer asks for Always, then iOS: While Using, then the upgrade.
    expect(bubbles(el)).toContain('Allow location Always');
    await click(button(el, 'Allow location'));
    await click(button(el, 'Allow While Using App'));
    expect(el.textContent).toContain('Keep Only While Using');
    await click(button(el, 'Change to Always Allow'));
    await click(button(el, 'Check in now'));
    expect(bubbles(el)).toContain('First check-in! +100.');
    await click(button(el, 'Not Now'));
    await click(next());

    expect(bubbles(el)).toContain("That's a day planned in 2 minutes — instead of hours of searching.");
    expect(bubbles(el)).toContain('How committed are you to exploring like this?');
    await click(button(el, 'Not really'));
    expect(bubbles(el)).toContain('No pressure.');
    await click(button(el, 'Make my day lighter'));
    expect(el.textContent).toContain('people built a day like this today');
    await click(next());

    expect(bubbles(el)).toContain('Save your 100 points + your day. It takes 20 seconds.');
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons.findIndex((t) => t.includes('Sign up with Google'))).toBeLessThan(buttons.findIndex((t) => t.includes('Create Account')));
    await click(button(el, 'Sign up with Google'));
    expect(el.textContent).toContain('Tab 1 of 2: Map');
    expect(bubbles(el)).toContain("Tap a pin to see the place and check in when you're there.");
    await click(button(el, 'Next tab'));
    expect(bubbles(el)).toContain("Your day lives here. I can fill a day with places you'll like.");
    await click(button(el, 'Finish'));
    expect(bubbles(el)).toContain('Come back tomorrow — 3 new places near you.');
    await click(button(el, 'Finish'));

    expect(el.textContent).toContain('Tutorial finished');
    expect(el.textContent).toContain('Signed up with: Google');
    expect(el.textContent).toContain('Categories: 3 picked, each +10: Food, Parks & Nature, Art & Culture');
    expect(el.textContent).toContain('First check-in: done');
    expect(el.textContent).toContain('tagScores changes');
    expect(el.textContent).toContain('What Mapr reads');
    expect(el.textContent).toContain('"No chains please"');
    expect(el.textContent).toContain('Location: Always');
    expect(el.textContent).toContain('What happened');
  });

  it("skipping the check-in doesn't block", async () => {
    const el = await render();
    await click([...el.querySelectorAll('.lab-step')][6]);
    await click(button(el, 'Not now'));
    expect(button(el, 'Check in now')).toBeFalsy();
    await click(button(el, 'Skip for now'));
    expect(bubbles(el)).toContain('How committed are you');
  });
});

describe('Official Onboarding pieces', () => {
  const miami = cityById('miami');

  it('lists only categories the city has places for, with the app icons', () => {
    const cats = cityCategories(miami);
    expect(cats.map((c) => c.id)).toEqual(expect.arrayContaining(['food', 'history-culture', 'parks-nature']));
    expect(cats.every((c) => c.icon && c.count > 0)).toBe(true);
    for (const city of CITIES) expect(cityCategories(city).length).toBeGreaterThan(2);
  });

  it('builds a 3-stop day from the picked categories', () => {
    const day = buildDay(miami, ['food', 'parks-nature'], []);
    expect(day).toHaveLength(3);
    expect(new Set(day.map((s) => s.id)).size).toBe(3);
    expect(day[1].categories).toContain('food');
    expect(lighterDay(day)).toHaveLength(2);
  });

  it("says the reflection in the owner's words and turns picks into love-it answers", () => {
    expect(reflectLine(['food', 'local-life'])).toBe('Okay — you want food and nightlife. Got it.');
    expect(reflectLine([])).toContain('Got it.');
    expect(answersFromCats(['food']).map((a) => [a.card.tag, a.answer])).toEqual([['food', 'love']]);
  });

  it('only writes blurbs for places that exist, short enough for a card', () => {
    const ids = new Set(ALL_LANDMARKS.map((l) => l.id));
    for (const [id, text] of Object.entries(PITCHES)) {
      expect(ids.has(id), id).toBe(true);
      expect(text.length, id).toBeLessThan(200);
      expect(text, id).not.toContain('\u2014');
    }
    expect(pitchFor({ id: 'nope', facts: ['A fact.'] })).toBe('A fact.');
  });
});
