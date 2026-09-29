// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ONBOARDING_VERSION } from '../lib/onboardingVersion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
afterEach(() => {
  container?.remove();
  localStorage.clear();
  document.documentElement.style.removeProperty('--banner-h');
  vi.resetModules();
});

async function renderBanner(profile, { fresh = true, variant } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: profile, profileFresh: fresh }) }));
  const { default: OnboardingBanner } = await import('./OnboardingBanner.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <OnboardingBanner variant={variant} />
      </MemoryRouter>
    );
  });
  return container;
}

describe('OnboardingBanner', () => {
  it('shows for an existing account without the current version', async () => {
    const el = await renderBanner({});
    expect(el.textContent).toContain('Finish onboarding');
  });

  it('shows for a new account that has not finished', async () => {
    const el = await renderBanner({ onboardingSource: 'signup' });
    expect(el.textContent).toContain('Finish onboarding');
  });

  it('stays hidden once the current version is done', async () => {
    const el = await renderBanner({ onboardingVersion: ONBOARDING_VERSION });
    expect(el.textContent).toBe('');
  });

  it('waits for the server copy of the profile', async () => {
    const el = await renderBanner({}, { fresh: false });
    expect(el.textContent).toBe('');
  });

  it('shows for a new account that skipped the cards at sign-up', async () => {
    const el = await renderBanner({ onboardingSource: 'signup-skipped' });
    expect(el.textContent).toContain('Finish onboarding');
  });

  it('cannot be dismissed, so it stays until onboarding is done', async () => {
    const el = await renderBanner({});
    expect(el.querySelector('[aria-label="Dismiss"]')).toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(1);
  });

  it('a floating banner reserves room for the map buttons, and gives it back when it goes away', async () => {
    const el = await renderBanner({}, { variant: 'fixed' });
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('56px');
    await act(async () => root.unmount());
    expect(el.textContent).toBe('');
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('');
  });

  it('reserves nothing once onboarding is done', async () => {
    await renderBanner({ onboardingVersion: ONBOARDING_VERSION }, { variant: 'fixed' });
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('');
  });
});
