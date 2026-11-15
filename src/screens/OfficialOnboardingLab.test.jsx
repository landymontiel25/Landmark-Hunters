// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { answersFromCats, buildDay, cityById, cityCategories, CITIES, reflectLine } from './officialOnboardingSteps';
import { PITCHES, pitchFor } from './officialOnboardingPitches';
import { ALL_LANDMARKS } from '../data/regions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  sessionStorage.clear();
  review.mockClear();
});

// Apple's review prompt: the web answer by default, set per test.
const review = vi.fn(async () => ({ shown: false, reason: 'web' }));

async function render() {
  vi.doMock('../lib/appReview', () => ({ requestAppReview: (...a) => review(...a) }));
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
  it("lists the owner's 9 steps in order, then the Hometown Transition, with the shared controls", async () => {
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
      '10. Hometown',
      '11. Back-home notification',
      '12. Hometown Transition',
    ]);
    expect(el.textContent).toContain('Nothing here is saved');
    for (const b of ['Restart', 'Back', 'Next step']) expect(button(el, b)).toBeTruthy();
    expect(el.textContent).toContain("Pretend I'm at the place");
    // Mapr's face is the logo in a squircle, no brain anywhere (owner, 2026-11-14).
    expect(el.querySelector('.mapr-bubble-face .mapr-tab-icon img').getAttribute('src')).toBe('/logo.png');
    expect(el.textContent).not.toContain('\u{1F9E0}');
  });

  it('walks the whole flow: no sign-up before step 9, 10 ratings jump on, check-in +100, summary', async () => {
    const el = await render();
    await click(el.querySelector('.fr-toggle input'));
    const next = () => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next \u{2192}');
    expect(bubbles(el)).toContain("Hi, I'm Mapr, your personal travel planner and guide. Together, we'll create a trip built around you, your interests, your time, and your sense of adventure. Let's do it!");
    await click(next());
    expect(bubbles(el)).toContain('tourist traps');
    await click(next());
    expect(bubbles(el)).toContain("I build your day from what you like.");
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
    expect(bubbles(el)).toContain('Okay, you want food, parks & nature and art & culture. Got it.');
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
    // The review ask at the peak (owner, 2026-11-15): never "five stars" by
    // name, and yes opens Apple's own prompt, not a screen of ours.
    expect(bubbles(el)).toContain("You're on a roll. You just checked in for the first time and I've got your day planned. If you're loving it so far, would you leave us a review? It really helps other travelers find us.");
    expect(el.textContent).not.toMatch(/five-star|5-star|comment optional/i);
    expect(next()).toBeFalsy();
    await click(button(el, 'Yes, I love it'));
    expect(review).toHaveBeenCalledOnce();
    expect(el.querySelector('.oo-review, .oo-stars, textarea')).toBeNull();
    expect(bubbles(el)).toContain('Thank you. That really helps.');
    // In a browser there's no system prompt: Test says what would happen.
    expect(el.querySelector('.oo-review-note').textContent).toBe("On iPhone, this opens Apple's own review prompt right here. A preview can't show it, and Apple decides when it appears.");
    await click(next());

    expect(bubbles(el)).toContain("That's a day planned in 2 minutes, instead of hours of searching.");
    // The summary is built from the real picks (owner, 2026-11-14).
    expect(bubbles(el)).toMatch(/Based on what you picked \((Food|Parks & Nature|Art & Culture), (Food|Parks & Nature|Art & Culture), and (Food|Parks & Nature|Art & Culture)\), I built your Miami day around you\. 3 stops, picked for you, in one afternoon\. This isn't a guess\. It's built from your picks\./);
    expect(bubbles(el)).not.toMatch(/picked nothing|I guessed|your your/);
    // Mapr speaks in the first person with contractions (owner, 2026-11-14).
    expect(bubbles(el)).not.toMatch(/Mapr built|This is not|It is built/);
    // A traveler question, not a commitment one (owner, 2026-11-14): all
    // four for now, the owner keeps one.
    expect(el.textContent).not.toMatch(/committed/i);
    for (const ask of ['What kind of traveler are you?', 'How do you like to spend a day in a new city?', "What's your ideal pace?", 'When are you traveling?']) expect(bubbles(el)).toContain(ask);
    for (const option of ['Explorer', 'Foodie', 'Chill', 'Adventurer', 'Wander and see what happens', 'Plan every stop', 'Follow what locals do', 'Slow and relaxed', 'See as much as possible', 'This weekend', 'Next month', 'Just dreaming for now']) expect(button(el, option)).toBeTruthy();
    expect([...el.querySelectorAll('button')].filter((b) => b.textContent === 'A bit of both')).toHaveLength(2);
    await click(button(el, 'Foodie'));
    expect(button(el, 'Foodie').getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('128 people built a day like this today.');
    await click(next());

    expect(bubbles(el)).toContain('Save your 100 points + your day. It takes 20 seconds.');
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons.findIndex((t) => t.includes('Sign up with Google'))).toBeLessThan(buttons.findIndex((t) => t.includes('Create Account')));
    await click(button(el, 'Sign up with Google'));
    // Every tab in the bar (owner, 2026-11-14), the Map's words as they were.
    expect(el.textContent).toContain('Tab 1 of 5: Map');
    expect([...el.querySelectorAll('.tut-nav-item')].map((b) => b.textContent)).toEqual(['\u{1F310}Map', '\u{1F4CD}Landmarks', 'Mapr', '\u{1F5FA}\u{FE0F}Itinerary', '\u{1F3C6}Profile']);
    expect(el.querySelector('.tut-nav .mapr-tab-icon img')).toBeTruthy();
    expect(el.textContent).toContain('Try it: tap a pin.');
    expect(bubbles(el)).toContain("Tap a pin to see the place and check in when you're there.");
    for (let i = 0; i < 4; i++) await click(button(el, 'Next tab') || button(el, 'Finish'));
    expect(bubbles(el)).toContain("Your points, streaks and check-ins live here.");
    await click(button(el, 'Finish'));
    expect(bubbles(el)).toContain("See you tomorrow, traveler. I'll have 3 new places near you.");
    expect(el.querySelector('.oo-hook-photo img').getAttribute('src')).toBe('/onboarding/onboarding-see-you-tomorrow.jpg');
    await click(button(el, 'Finish'));

    // Step 10: onboarding only asks where home is (owner, 2026-11-14). No pitch.
    expect(bubbles(el)).toContain("Where's home?");
    expect(el.textContent).not.toContain('already convinced');
    await click(button(el, 'Miami'));
    await click(button(el, 'Finish'));

    // Step 11, after the trip: one notification with their real numbers.
    const notif = el.querySelector('.oo-notif');
    expect(notif.textContent).toMatch(/You're back home in Miami\. You've only been to 12 of [\d,]+ places here, and I already know what you like\. Want me to pick 3 near you for tomorrow\?/);
    await click(notif);

    // Step 12: the Hometown Transition screen it opens.
    expect(el.textContent).toContain('Official Onboarding: Hometown Transition');
    expect(el.querySelector('.oo-home-map')).toBeTruthy();
    expect(el.querySelector('.oo-home-stat').textContent).toMatch(/^You've been to 12 of [\d,]+ places in Miami\.$/);
    expect(bubbles(el)).toMatch(/You already trust me with your trips \(and I know what you like from those trips\)\. You live in Miami and you've only been to 12 of [\d,]+ places here\. At home it's less about landmarks, so here's somewhere to eat, somewhere to drink, and one more from what you picked\./);
    expect(el.querySelector('.oo-home-h3').textContent).toBe('3 amazing places for tomorrow');
    expect(bubbles(el)).not.toMatch(/guess/i);
    const picks = [...el.querySelectorAll('.oo-home-pick-row')];
    expect(picks).toHaveLength(3);
    // A restaurant and a bar first (owner, 2026-11-14), then one of their kinds.
    expect(picks[0].textContent).toContain('A place to eat near you');
    expect(picks[1].textContent).toContain('A bar near you');
    expect(picks[2].textContent).toMatch(/Because you picked (parks & nature|art & culture)/);
    expect(el.textContent).toContain('Your streak is at 3 days, don\'t break it. I found a spot for tomorrow.');
    expect(el.textContent).not.toContain('\u2014');
    expect(el.textContent).toContain("I only message you when I've got a real pick.");
    await click(button(el, 'Save to Tomorrow in Miami'));
    expect(button(el, 'Saved to Tomorrow in Miami')).toBeTruthy();
    await click(button(el, 'Show me my city'));

    expect(el.textContent).toContain('Tutorial finished');
    // No em dash anywhere in Official Onboarding (owner, 2026-11-14).
    expect(el.textContent).not.toContain('\u2014');
    expect(el.textContent).toContain('Signed up with: Google');
    expect(el.textContent).toContain('Categories: 3 picked, each +10: Food, Parks & Nature, Art & Culture');
    expect(el.textContent).toContain('First check-in: done');
    expect(el.textContent).toContain('tagScores changes');
    expect(el.textContent).toContain('What Mapr reads');
    expect(el.textContent).toContain('"No chains please"');
    expect(el.textContent).toContain('Location: Always');
    expect(el.textContent).toMatch(/Picks: .+, .+, .+ \(saved to Tomorrow in Miami\)/);
    expect(el.textContent).toContain('What happened');
  });

  it("in the iOS app, yes opens Apple's prompt with no preview note", async () => {
    review.mockImplementationOnce(async () => ({ shown: true }));
    const el = await render();
    await click(el.querySelector('input[type="checkbox"]'));
    await click([...el.querySelectorAll('.lab-step')][6]);
    for (const t of ['Allow location', 'Allow While Using App', 'Change to Always Allow', 'Check in now', 'Yes, I love it']) await click(button(el, t));
    expect(review).toHaveBeenCalledOnce();
    expect(el.querySelector('.oo-review-note')).toBeNull();
    expect(bubbles(el)).toContain('Thank you. That really helps.');
  });

  it('"Not yet" skips the review ask and it isn\'t asked again this session', async () => {
    const reach = async (el) => {
      await click([...el.querySelectorAll('.lab-step')][6]);
      await click(button(el, 'Allow location'));
      await click(button(el, 'Allow While Using App'));
      await click(button(el, 'Change to Always Allow'));
      await click(button(el, 'Check in now'));
    };
    let el = await render();
    const next = () => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next \u{2192}');
    await click(el.querySelector('input[type="checkbox"]'));
    await reach(el);
    expect(bubbles(el)).toContain('would you leave us a review?');
    await click(button(el, 'Not yet'));
    expect(review).not.toHaveBeenCalled();
    expect(bubbles(el)).not.toContain('would you leave us a review?');
    expect(el.querySelector('.oo-review')).toBeNull();
    expect(next()).toBeTruthy();
    // A new run in the same session: no ask.
    container.remove();
    vi.resetModules();
    el = await render();
    await click(el.querySelector('input[type="checkbox"]'));
    await reach(el);
    expect(bubbles(el)).toContain('First check-in! +100.');
    expect(bubbles(el)).not.toContain('would you leave us a review?');
    // The Test-only link brings it back for the owner.
    await click(button(el, 'Show the ask again (Test only)'));
    expect(bubbles(el)).toContain('would you leave us a review?');
    expect(el.textContent).not.toContain('\u2014');
  });

  it("skipping the check-in doesn't block", async () => {
    const el = await render();
    await click([...el.querySelectorAll('.lab-step')][6]);
    await click(button(el, 'Not now'));
    expect(button(el, 'Check in now')).toBeFalsy();
    await click(button(el, 'Skip for now'));
    expect(bubbles(el)).toContain('What kind of traveler are you?');
  });
});

describe('Hometown Transition pieces', () => {
  it('picks a restaurant, a bar, then one of their kinds, all unvisited (owner, 2026-11-14)', async () => {
    const { cityPlaces, visitedSample, hometownPicks, shockStat, homeAnchor, isBar } = await import('./officialOnboardingHometown');
    const miami = cityById('miami');
    const places = cityPlaces(miami);
    const visited = visitedSample(places);
    expect(visited).toHaveLength(12);
    const picks = hometownPicks(places, visited, ['food', 'parks-nature'], homeAnchor(places, visited, null));
    expect(picks).toHaveLength(3);
    expect(picks.map((p) => p.kind)).toEqual(['food', 'bar', 'parks-nature']);
    expect(picks[0].place.categories).toContain('food');
    // A real restaurant, never a chain like Starbucks.
    const { isRestaurant, chainNames } = await import('./officialOnboardingHometown');
    expect(isRestaurant(picks[0].place)).toBe(true);
    expect(isRestaurant({ categories: ['food'], topic: 'café' })).toBe(false);
    expect(chainNames([{ name: 'Starbucks' }, { name: 'Starbucks' }, { name: 'Starbucks' }, { name: "Joe's" }]).has('Starbucks')).toBe(true);
    const chains = chainNames(places);
    expect(picks.some((p) => chains.has(p.place.name))).toBe(false);
    expect(isBar(picks[1].place)).toBe(true);
    expect(picks[2].place.categories).toContain('parks-nature');
    const seen = new Set(visited.map((l) => l.id));
    expect(picks.some((p) => seen.has(p.place.id))).toBe(false);
    expect(shockStat(miami, 12, 1059)).toBe('12 of 1,059 places in Miami');
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
  });

  it('writes the summary from the real picks, never "picked nothing" or "I guessed" (owner, 2026-11-14)', async () => {
    const { summaryLines } = await import('./officialOnboardingSteps');
    const day = buildDay(miami, ['food'], []);
    const [line] = summaryLines({ city: miami, chips: ['food', 'parks-nature'], loved: ['Vizcaya'], stops: day });
    expect(line).toBe("Based on what you picked (Food and Parks & Nature) and the places you loved (Vizcaya), I built your Miami day around you. 3 stops, picked for you, in one afternoon. This isn't a guess. It's built from your picks.");
    for (const chips of [[], ['food']]) {
      const text = summaryLines({ city: miami, chips, stops: day }).join(' ');
      expect(text).not.toMatch(/picked nothing|I guessed|your your|\u2014/);
    }
  });

  it("says the reflection in the owner's words and turns picks into love-it answers", () => {
    expect(reflectLine(['food', 'local-life'])).toBe('Okay, you want food and nightlife. Got it.');
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
