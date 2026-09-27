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

async function renderAs(email) {
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
  it('sends non-admins away', async () => {
    const el = await renderAs('someone@example.com');
    expect(el.textContent).toContain('home');
  });

  it('walks the whole flow and restarts', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    expect(el.textContent).toContain('Create Account');

    await click(button(el, 'Sign up with Google'));
    expect(el.textContent).toContain('Rate a few things you');

    await click(button(el, 'Next'));
    expect(el.textContent).toContain('Swipe right → love it');

    await click(button(el, 'Start'));
    const love = el.querySelector('[aria-label="Love it"]');
    const total = Number(el.querySelector('.lab-progress').textContent.split('/')[1]);
    expect(total).toBe(45);
    for (let n = 0; n < total; n += 1) {
      await click(n === 0 ? love : el.querySelector('[aria-label="Not sure"]'));
      await act(async () => new Promise((r) => setTimeout(r, 230)));
    }
    expect(el.textContent).toContain('All done');

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

    await click(button(el, 'Restart sign-up'));
    expect(el.textContent).toContain('Create Account');
  }, 30000);

  it('Skip on the rate prompt goes straight to the end with no preference data', async () => {
    const el = await renderAs('landymontiel25@gmail.com');
    await click(button(el, 'Sign up with Google'));
    await click([...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Skip'));
    expect(el.textContent).toContain('no preference data yet');
  });
});
