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

async function renderAs(email, { nothingToTest = false } = {}) {
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
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('OnboardingLab', () => {
  it('says there is nothing to test while the sandbox is switched off', async () => {
    const el = await renderAs('landymontiel25@gmail.com', { nothingToTest: true });
    expect(el.textContent).toContain('Nothing to test');
    expect(el.textContent).not.toContain('Rate a few things you');
  });

  it('lets an admin reset their own onboarding to try the update notice again', async () => {
    const reset = vi.fn(async () => {});
    vi.doMock('../lib/onboardingSave', () => ({ resetOnboarding: reset }));
    const el = await renderAs('landymontiel25@gmail.com', { nothingToTest: true });
    await click(button(el, 'Reset my onboarding'));
    expect(reset).toHaveBeenCalledWith('u');
    expect(el.textContent).toContain('Reset. Reload the app');
  });

  it('sends non-admins away', async () => {
    const el = await renderAs('someone@example.com');
    expect(el.textContent).toContain('home');
  });

  it('walks the whole flow and restarts', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    expect(el.textContent).not.toContain('Create Account');
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
    expect(el.textContent).toContain('What Mapr would recommend');
    expect(el.textContent).toContain('Loves: ');
    expect(el.querySelectorAll('.lab-rec').length).toBeGreaterThan(0);

    await click(button(el, 'Restart'));
    expect(el.textContent).toContain('Rate a few things you');
  }, 30000);

  it('Skip on the rate prompt goes straight to the end with no preference data', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await click([...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Skip'));
    expect(el.textContent).toContain('no preference data yet');
  });

  it('Undo brings back the last card and drops its answer', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
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
