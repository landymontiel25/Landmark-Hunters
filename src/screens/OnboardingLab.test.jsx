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

// The Test tab opens on Malls; `tab: 'onboarding'` (the default here, for the
// onboarding tests) switches to that bubble first.
async function renderAs(email, { nothingToTest = false, tab = 'onboarding' } = {}) {
  vi.doMock('./onboardingLabConfig', () => ({ NOTHING_TO_TEST: nothingToTest }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: email ? { uid: 'u', email } : null }) }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, loading: false }) }));
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
  const bubble = tab && [...container.querySelectorAll('.lab-tabs [role="tab"]')].find((t) => t.textContent === (tab === 'malls' ? 'Malls' : 'Onboarding'));
  if (bubble) await act(async () => bubble.click());
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const signUp = (el) => click(button(el, 'Sign up with Google'));

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

  it('opens on the Malls bubble, with Onboarding next to it', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: null });
    const tabs = [...el.querySelectorAll('.lab-tabs [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Malls', 'Onboarding']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.mall-lab-map .leaflet-container')).toBeTruthy();
  });

  it('mall check-in: tap a mall, Check In, pick stores, rate them, say what you like', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { tab: 'malls' });
    const btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    // Only malls on the map, as the real Map's pins.
    const pins = [...el.querySelectorAll('.mall-lab-map .leaflet-marker-icon')];
    expect(pins.length).toBeGreaterThanOrEqual(5);
    const dolphin = pins.find((p) => p.getAttribute('title') === 'Dolphin Mall');
    await act(async () => dolphin.click());
    await act(async () => btn('Check In').click());
    expect(document.body.textContent).toContain("You're checked in at");
    expect(document.body.textContent).toContain('Which stores did you go into?');
    const chips = [...document.querySelectorAll('.mall-lab-store-chip')];
    expect(chips.length).toBeGreaterThan(5);
    await act(async () => chips[0].click());
    await act(async () => chips[1].click());
    await act(async () => btn('Next (2)').click());
    expect(document.body.textContent).toContain('store 1 of 2');
    await act(async () => btn('Liked it').click());
    expect(document.body.textContent).toContain('What did you like about it?');
    await act(async () => btn('friendly staff').click());
    await act(async () => btn('Next store').click());
    await act(async () => btn('Not for me').click());
    await act(async () => btn('Next').click());
    expect(document.body.textContent).toContain('What do you like about Dolphin Mall?');
    await act(async () => btn('easy parking').click());
    await act(async () => btn('Save').click());
    expect(document.body.textContent).toContain('Visit saved');
    expect(document.body.textContent).toContain('What Mapr learned');
    await act(async () => btn('Done').click());
    expect(document.querySelector('.mall-visit')).toBeNull();
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

  it('walks the whole flow and restarts', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    expect(el.textContent).toContain('Create Account');
    expect(el.textContent).toContain('Terms of Service');
    await signUp(el);
    expect(el.textContent).toContain("Tell us up to 10 places you visit most, and we'll help you discover new spots you'll love.");
    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('Rate a few things you');

    await click(button(el, 'Next'));
    expect(el.textContent).toContain('Love it: swipe right or tap ♥');
    expect(el.textContent).toContain("Don't like it: swipe left or tap ✕");
    expect(el.textContent).toContain("Not sure or don't care (you'll be asked again later): tap the card or tap −");

    await click(button(el, 'Start'));
    expect(el.querySelector('.lab-progress').className).toContain('lab-tier-red');
    const love = el.querySelector('[aria-label="Love it"]');
    expect(el.querySelector('.lab-progress').textContent).toBe('0%');
    const total = Number(el.querySelector('.lab-bar').getAttribute('aria-valuemax'));
    expect(total).toBe(39);
    for (let n = 0; n < total; n += 1) {
      await click(n === 0 ? love : el.querySelector('[aria-label="Not sure"]'));
      await act(async () => new Promise((r) => setTimeout(r, 230)));
    }
    expect(el.textContent).toContain('All done');
    expect(el.querySelector('.lab-progress').className).toContain('lab-tier-done');
    expect(el.querySelector('.lab-progress').textContent).toBe('100%');
    expect(el.querySelector('.lab-bar span').style.width).toBe('100%');

    await click(button(el, 'Continue →'));
    expect(el.textContent).toContain("Anything else you love or hate that we didn't cover?");

    await click(button(el, 'Continue'));
    expect(el.textContent).toContain('Your First Check-In');

    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('Onboarding finished');
    expect(el.textContent).toContain('1 love it');
    expect(el.textContent).toContain('+10');
    expect(el.textContent).not.toContain('What Mapr would recommend');
    expect(el.querySelectorAll('.lab-rec').length).toBe(0);

    await click(button(el, 'Restart'));
    expect(el.textContent).toContain('Create Account');
  }, 30000);

  it('suggests places while typing and Tab adds the top match', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await signUp(el);
    const input = el.querySelector('#lab-place');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, 'liberty');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const options = el.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    const topName = options[0].textContent;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(el.querySelector('.lab-place-list').textContent).toContain(topName.split(' ')[0]);
    expect(el.textContent).toContain('Place 1 of 10');
    await click(el.querySelector('[aria-label^="Remove"]'));
    expect(el.querySelector('.lab-place-list')).toBeNull();
  });

  it('Skip on the rate prompt goes straight to the end with no preference data', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await signUp(el);
    await click(button(el, 'Skip for now'));
    await click([...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Skip'));
    expect(el.textContent).toContain('no preference data yet');
  });

  it('Undo brings back the last card and drops its answer', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await signUp(el);
    await click(button(el, 'Skip for now'));
    await click(button(el, 'Next'));
    await click(button(el, 'Start'));
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
