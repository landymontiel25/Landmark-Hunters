// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ONBOARDING_VERSION } from '../lib/onboardingVersion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let OnboardingBanner;
afterEach(() => {
  container?.remove();
  localStorage.clear();
  document.documentElement.style.removeProperty('--banner-h');
  vi.resetModules();
});

async function renderBanner(profile, { fresh = true, variant } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: profile, profileFresh: fresh }) }));
  ({ default: OnboardingBanner } = await import('./OnboardingBanner.jsx'));
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
    expect(el.textContent).toContain('Finish the swipe cards');
  });

  it('shows for a new account that has not finished', async () => {
    const el = await renderBanner({ onboardingSource: 'signup' });
    expect(el.textContent).toContain('Finish the swipe cards');
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
    expect(el.textContent).toContain('Finish the swipe cards');
  });

  it('can be dismissed for the session, and is back the next time the app opens', async () => {
    let el = await renderBanner({});
    const x = el.querySelector('[aria-label="Dismiss for now"]');
    expect(x).not.toBeNull();
    await act(async () => x.click());
    expect(el.textContent).toBe('');
    // Still hidden when the screen is shown again in the same session
    // (the Map and Mapr tabs each mount their own banner).
    await act(async () => root.unmount());
    root = createRoot(el);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <OnboardingBanner />
        </MemoryRouter>
      );
    });
    expect(el.textContent).toBe('');
    // A new session (fresh module state, nothing persisted) shows it again.
    el.remove();
    vi.resetModules();
    el = await renderBanner({});
    expect(el.textContent).toContain('Finish the swipe cards');
  });

  it('dismissing gives the map its room back', async () => {
    const el = await renderBanner({}, { variant: 'fixed' });
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('56px');
    await act(async () => el.querySelector('[aria-label="Dismiss for now"]').click());
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('');
  });

  it('never shows to an account that finished, dismissed or not', async () => {
    const el = await renderBanner({ onboardingVersion: ONBOARDING_VERSION });
    expect(el.textContent).toBe('');
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
