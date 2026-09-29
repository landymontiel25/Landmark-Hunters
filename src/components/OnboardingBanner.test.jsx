// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ONBOARDING_VERSION } from '../lib/onboardingVersion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  localStorage.clear();
  vi.resetModules();
});

async function renderBanner(profile, { fresh = true, variant } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: profile, profileFresh: fresh }) }));
  const { default: OnboardingBanner } = await import('./OnboardingBanner.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
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

  it('can be dismissed, and stays dismissed', async () => {
    let el = await renderBanner({});
    await act(async () => el.querySelector('[aria-label="Dismiss"]').click());
    expect(el.textContent).toBe('');
    el.remove();
    vi.resetModules();
    el = await renderBanner({});
    expect(el.textContent).toBe('');
  });

  it('a floating banner reserves room for the map buttons, and gives it back', async () => {
    const el = await renderBanner({}, { variant: 'fixed' });
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('56px');
    await act(async () => el.querySelector('[aria-label="Dismiss"]').click());
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('');
  });
});
