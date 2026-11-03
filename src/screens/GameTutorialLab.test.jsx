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

async function render() {
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: {} }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c' } }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, loading: false }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: (m) => `${Math.round(m)} m` }));
  vi.doMock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: {} }) }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] } }) }));
  const { default: GameTutorialLab } = await import('./GameTutorialLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <GameTutorialLab />
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const bubbles = (el) => [...el.querySelectorAll('.mapr-bubble')].map((b) => b.textContent).join(' ');

describe('Game tutorial (Test tab)', () => {
  it("has the owner's seven steps in order", async () => {
    const el = await render();
    expect([...el.querySelectorAll('.lab-step')].map((b) => b.textContent)).toEqual([
      '1. Hello',
      '2. Sign up',
      '3. Verify email',
      '4. 5 images',
      '5. First check-in',
      '6. Your tabs',
      '7. Done',
    ]);
  });

  it('walks every step with Mapr talking, including each of the 5 images', async () => {
    const el = await render();
    expect(bubbles(el)).toContain("Hi! I'm Mapr");
    await click(button(el, "Let's go"));
    expect(bubbles(el)).toContain('First, make your account');
    await click(button(el, 'Sign up with Google'));
    expect(bubbles(el)).toContain('I sent you an email');
    await click(button(el, 'I tapped the link'));

    const lines = [
      ['Discover', "Here's how the game works."],
      ['Arrive prepared', 'every place has its facts and photos'],
      ['Plan Less', 'I line them up into one route.'],
      ['Play', 'check in. Each check-in earns points'],
      ['Remember', 'Every place you check in to stays here'],
    ];
    for (const [title, line] of lines) {
      expect(el.querySelector('.intro-title').textContent).toBe(title);
      expect(bubbles(el)).toContain(line);
      await click(el.querySelector('.intro-next'));
    }

    expect(bubbles(el)).toContain('Checking in is how you collect a landmark.');
    await click(button(el, 'Skip for now'));
    for (let i = 0; i < 4; i += 1) await click(button(el, 'Next tab'));
    await click(button(el, 'Finish'));

    expect(bubbles(el)).toContain("That's it!");
    expect(el.textContent).toContain('5 images: watched all 5');
    expect(el.textContent).toContain('First check-in: skipped');
    await click(button(el, 'Restart'));
    expect(bubbles(el)).toContain("Hi! I'm Mapr");
  });

  it('Skip on the 5 images goes to the check-in; pretending checks you in', async () => {
    const el = await render();
    await click(el.querySelector('.fr-toggle input'));
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.startsWith('4.')));
    await click(el.querySelector('.intro-skip'));
    expect(el.textContent).toContain("You're here. Check in for your first points.");
    await click(button(el, 'Check in'));
    expect(el.querySelector('.tut-count').textContent).toContain('Map');
    await click([...el.querySelectorAll('.lab-step')].find((b) => b.textContent.startsWith('7.')));
    expect(el.textContent).toContain('5 images: skipped');
    expect(el.textContent).not.toContain('First check-in: skipped');
  });
});
