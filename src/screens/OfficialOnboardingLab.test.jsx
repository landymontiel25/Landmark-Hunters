// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { buildDay, cityById, progressLine, rateDeck, reflectLine, lighterDay } from './officialOnboardingSteps';

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
      '4. Rate 10',
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
    expect(bubbles(el)).toContain("Hi! I'm Mapr, your personal AI guide.");
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
    expect(bubbles(el)).toContain("Skip and I'll guess. Pick and I'll get it right.");
    expect(next().disabled).toBe(true);
    await click(button(el, 'Food'));
    await click(button(el, 'Parks & Nature'));
    expect(next().disabled).toBe(true);
    await click(button(el, 'Art & Culture'));
    expect(next().disabled).toBe(false);
    await click(next());

    // No practice: the first card is real.
    expect(el.textContent).toContain('0 of 10 — 10 more and Mapr can pick for you.');
    expect(el.textContent).not.toContain('Sign up with Google');
    await click(el.querySelector('[aria-label="Not sure"]'));
    await wait(260);
    expect(el.textContent).toContain('0 of 10');
    for (let i = 0; i < 10; i++) {
      await click(el.querySelector(i < 7 ? '[aria-label="Love it"]' : `[aria-label="Don't like it"]`));
      await wait(260);
      if (i === 6) expect(el.textContent).toContain('7 of 10 — 3 more and Mapr can pick for you.');
    }

    // The 10th rating goes straight on.
    expect(bubbles(el)).toMatch(/Okay — you want food, parks & nature and art & culture, and you loved .+\. Got it\./);
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

    // Location primer first, then the iOS prompt without Always.
    expect(bubbles(el)).toContain('While Using the App only');
    await click(button(el, 'Allow location'));
    expect(el.textContent).toContain('Allow While Using App');
    expect(el.textContent).not.toContain('Always');
    await click(button(el, 'Allow While Using App'));
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
    expect(el.textContent).toContain("10 of 10 rated — 7 love it, 3 don't like it, 1 not sure");
    expect(el.textContent).toContain('First check-in: done');
    expect(el.textContent).toContain('tagScores changes');
    expect(el.textContent).toContain('What Mapr reads');
    expect(el.textContent).toContain('"No chains please"');
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

  it("deals the city's famous places, more than 10", () => {
    const deck = rateDeck(miami, ['food']);
    expect(deck.length).toBeGreaterThan(10);
    expect(deck.every((c) => c.place.regionId === 'miami' && c.photos.length === 1)).toBe(true);
  });

  it('builds a 3-stop day starting at a loved place, never a disliked one', () => {
    const deck = rateDeck(miami, ['food', 'parks-nature']);
    const answers = [
      { card: deck[0], answer: 'dislike' },
      { card: deck[1], answer: 'love' },
    ];
    const day = buildDay(miami, ['food', 'parks-nature'], answers);
    expect(day).toHaveLength(3);
    expect(day[0].id).toBe(deck[1].place.id);
    expect(day.some((s) => s.id === deck[0].place.id)).toBe(false);
    expect(new Set(day.map((s) => s.id)).size).toBe(3);
    expect(lighterDay(day)).toHaveLength(2);
  });

  it('says progress and the reflection in the owner’s words', () => {
    expect(progressLine(7)).toBe('7 of 10 — 3 more and Mapr can pick for you.');
    expect(reflectLine(['food'], [{ card: { word: 'Wynwood Walls' }, answer: 'love' }])).toBe('Okay — you want food, and you loved Wynwood Walls. Got it.');
  });
});
