// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ONBOARDING_VERSION } from '../lib/onboardingVersion';
import { ALL_SWIPE_CARDS } from '../lib/onboardingCards';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

const saved = { results: vi.fn(async () => {}), progress: vi.fn(async () => {}), end: vi.fn(async () => {}), tasteIntro: vi.fn(async () => {}) };

// user: { emailVerified }, profile: users/{uid} doc, checkins: real check-in count
async function renderFlow({ user = { uid: 'u', email: 'a@b.co', emailVerified: true }, profile = {}, checkins = 3, isNew } = {}) {
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({ user, firebaseEnabled: true, resendVerification: vi.fn(), refreshUser: async () => {} }),
  }));
  vi.doMock('../lib/FriendsContext', () => ({
    useFriends: () => ({ myProfile: profile, profileFresh: true, reload: async () => {}, myUsername: 'me' }),
  }));
  vi.doMock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: [] }, toggleSavedInterest: () => {} }) }));
  vi.doMock('../lib/onboardingSave', async () => ({
    ...(await vi.importActual('../lib/onboardingSave')),
    saveOnboardingResults: saved.results,
    saveOnboardingProgress: saved.progress,
    endOnboardingFlow: saved.end,
  }));
  vi.doMock('../lib/friends', () => ({ saveTasteIntro: saved.tasteIntro }));
  vi.doMock('../lib/notifications', () => ({ markNotificationRead: async () => {} }));
  vi.doMock('../lib/useWelcomeBonus', () => ({ useWelcomeBonus: () => ({ saveError: null, retry: () => {} }) }));
  vi.doMock('../lib/firstCheckIn', async () => ({
    ...(await vi.importActual('../lib/firstCheckIn')),
    useCheckinCount: () => ({ count: checkins, loading: false }),
  }));
  vi.doMock('../components/FirstCheckInStep', () => ({ default: () => <p>FIRST CHECK-IN STEP</p> }));
  vi.doMock('../components/LocationAlwaysStep', () => ({ default: () => <p>LOCATION STEP</p> }));

  const { default: Onboarding } = await import('./Onboarding.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding isNew={isNew} />} />
          <Route path="/profile" element={<p>profile page</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('Onboarding: completed user', () => {
  it('has nothing to do and goes back to Profile', async () => {
    const el = await renderFlow({ profile: { onboardingVersion: ONBOARDING_VERSION } });
    expect(el.textContent).toContain('profile page');
  });

  it('still resumes a half-finished first check-in', async () => {
    const el = await renderFlow({
      profile: { onboardingVersion: ONBOARDING_VERSION, onboardingProgress: { version: ONBOARDING_VERSION, step: 'checkin' } },
      checkins: 0,
    });
    expect(el.textContent).toContain('FIRST CHECK-IN STEP');
  });
});

describe('Onboarding: existing user (account from before the flow existed)', () => {
  it('sees the updated-onboarding welcome, no email step, and can skip everything', async () => {
    const el = await renderFlow({ profile: { username: 'old-timer', onboardingCompleted: true }, checkins: 12 });
    expect(el.textContent).toContain('Onboarding has been updated');
    expect(el.textContent).not.toContain('Verify your email');

    await click(button(el, 'Skip'));
    expect(el.textContent).toContain('Anything else?');
    await click(button(el, 'Skip for now'));

    // What was answered is saved, but skipping the cards doesn't finish
    // onboarding, so the notification and banner stay. With a check-in already
    // on record the flow ends without asking for another or for "Always" location.
    expect(saved.results).toHaveBeenCalledTimes(1);
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: false });
    expect(el.textContent).toContain("You're set for now");
    expect(el.textContent).not.toContain('FIRST CHECK-IN STEP');
    expect(el.textContent).not.toContain('LOCATION STEP');
  });

  it('finishing every card is what completes it', async () => {
    const el = await renderFlow({
      profile: {
        onboardingCompleted: true,
        onboardingProgress: {
          version: ONBOARDING_VERSION,
          step: 'notes',
          cardWords: ALL_SWIPE_CARDS.map((c) => c.word),
          answers: ALL_SWIPE_CARDS.map((c) => ({ word: c.word, answer: 'love' })),
        },
      },
      checkins: 5,
    });
    await click(button(el, 'Skip for now'));
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: true });
    expect(el.textContent).toContain("You're all set");
  });

  it('but an existing account with no check-in yet still gets the first check-in step', async () => {
    const el = await renderFlow({ profile: { onboardingCompleted: true }, checkins: 0 });
    await click(button(el, 'Skip'));
    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('FIRST CHECK-IN STEP');
  });

  it('pre-fills earlier answers and resumes at the saved step', async () => {
    const el = await renderFlow({
      profile: {
        onboardingCompleted: true,
        onboardingProgress: { version: ONBOARDING_VERSION, step: 'notes', cardWords: ['Steak'], answers: [{ word: 'Steak', answer: 'love' }] },
        tasteIntro: 'I love racing',
      },
    });
    expect(el.textContent).toContain('Anything else?');
    expect(el.querySelector('textarea').value).toBe('I love racing');
  });
});

describe('Onboarding: new user', () => {
  const profile = { onboardingSource: 'signup' };

  it('waits on the email step until the address is verified', async () => {
    const el = await renderFlow({ user: { uid: 'u', email: 'new@user.co', emailVerified: false }, profile, isNew: true, checkins: 0 });
    expect(el.textContent).toContain('Verify your email');
    expect(el.textContent).toContain('new@user.co');
    expect(el.textContent).not.toContain("You're in!");
  });

  it('runs the flow once verified, ending with the required first check-in and location', async () => {
    const el = await renderFlow({ profile, isNew: true, checkins: 0 });
    expect(el.textContent).toContain("You're in!");

    await click(button(el, 'Skip'));
    await click(button(el, 'Skip for now'));
    expect(saved.results).toHaveBeenCalledTimes(1);
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: false });
    expect(el.textContent).toContain('FIRST CHECK-IN STEP');
  });
});
