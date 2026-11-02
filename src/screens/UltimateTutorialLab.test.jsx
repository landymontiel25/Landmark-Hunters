// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render({ coords = null } = {}) {
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: {} }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c' } }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords, loading: false }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: (m) => `${Math.round(m)} m` }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: { a: {}, b: {} } }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] } }) }));
  const { default: UltimateTutorialLab } = await import('./UltimateTutorialLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <UltimateTutorialLab />
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const exact = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const bubbles = (el) => [...el.querySelectorAll('.mapr-bubble')].map((b) => b.textContent).join(' ');

describe('Tutorial with planner (Test tab, was Ultimate tutorial)', () => {
  it("lists the owner's 12 steps in order, each marked with its tutorial", async () => {
    const el = await render();
    expect([...el.querySelectorAll('.lab-step')].map((b) => b.textContent)).toEqual([
      '1. Hello T1',
      '2. Sign up T1',
      '3. Verify email T1',
      '4. Swipe practice T1',
      '5. Cards T1',
      '6. Taste pick T2',
      '7. Anything else T1',
      '8. First check-in T2',
      '9. Progress T2',
      '10. Location T2',
      '11. Your tabs T2',
      '12. Done T1',
    ]);
  });

  it('walks every step with Mapr talking on each, then shows the results', async () => {
    const el = await render();
    expect(bubbles(el)).toContain("Hi! I'm Mapr");
    await click(button(el, "Let's go"));
    expect(bubbles(el)).toContain('First, make your account');
    await click(button(el, 'Sign up with Google'));
    expect(bubbles(el)).toContain('I sent you an email');
    await click(button(el, 'I tapped the link'));
    expect(bubbles(el)).toContain('swipe or tap');
    await click(button(el, "Let's practice"));
    await click(button(el, 'Skip practice'));
    await click(button(el, 'Start'));
    expect(bubbles(el)).toContain('This takes a minute max.');
    await click(el.querySelector('[aria-label="Love it"]'));
    await act(async () => new Promise((r) => setTimeout(r, 230)));
    await click(button(el, 'Skip this step'));

    // 6. Taste pick (T2), with Mapr's new lines.
    expect(bubbles(el)).toContain("Now pick 3 to 5 kinds of places you're into.");
    expect(el.textContent).toContain('What are you into?');
    const next = exact(el, 'Next');
    expect(next.disabled).toBe(true);
    for (const chip of [...el.querySelectorAll('.fr-chip')].slice(0, 3)) await click(chip);
    expect(next.disabled).toBe(false);
    await click(next);

    // 7. Anything else (T1).
    expect(bubbles(el)).toContain('Anything else you love or hate');
    await click(button(el, 'Continue'));

    // 8. First check-in (T2): no location, so Mapr explains and you can skip.
    expect(bubbles(el)).toContain('Checking in is how you collect a landmark.');
    expect(el.textContent).toContain('We use your location to see if you are at the place.');
    await click(button(el, 'Skip for now'));

    // 9. Progress (T2): the account's 2 ratings plus the 1 loved card.
    expect(bubbles(el)).toContain('Every place you rate teaches me your taste.');
    expect(el.textContent).toContain('3 of 10 ratings');
    expect(el.textContent).not.toContain('First check-in!');
    await click(exact(el, 'Next'));

    // 10. Location, 11. Your tabs.
    expect(el.textContent).toContain('Always Allow');
    await click(exact(el, 'Next \u2192'));
    for (let i = 0; i < 4; i += 1) await click(button(el, 'Next tab'));
    await click(button(el, 'Finish'));

    // 12. Done (T1): Mapr's goodbye and the results.
    expect(bubbles(el)).toContain("That's it!");
    expect(el.textContent).toContain('Tutorial finished');
    expect(el.textContent).toContain('Taste picks:');
    expect(el.textContent).not.toContain('Places you visit most');
    expect(el.textContent).toContain('First check-in: skipped');
    await click(button(el, 'Restart'));
    expect(bubbles(el)).toContain("Hi! I'm Mapr");
  });

  it('pretending to be at a place checks you in; Progress then shows the badge', async () => {
    const el = await render();
    await click(el.querySelector('.fr-toggle input'));
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.startsWith('8.')));
    expect(el.textContent).toContain("You're here. Check in for your first points.");
    await click(button(el, 'Check in'));
    expect(bubbles(el)).toContain('And you checked in!');
    expect(el.textContent).toContain('First check-in!');
  });

  it('Skip for now on Taste pick moves on with no picks', async () => {
    const el = await render();
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.startsWith('6.')));
    await click(button(el, 'Skip for now'));
    expect(bubbles(el)).toContain('Anything else you love or hate');
  });
});
