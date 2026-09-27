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
    expect(el.textContent).toContain('What are you usually into?');

    await click(el.querySelector('.chip'));
    await click(button(el, 'Continue →'));
    expect(el.textContent).toContain('Tell Mapr what you love');

    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('Your First Check-In');

    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('Onboarding finished');
    expect(el.textContent).toContain('Google');
    expect(el.textContent).toContain('Skipped taste intro');

    await click(button(el, 'Restart sign-up'));
    expect(el.textContent).toContain('Create Account');
  });
});
