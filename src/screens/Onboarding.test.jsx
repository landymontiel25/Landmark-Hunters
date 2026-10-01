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

const saved = { results: vi.fn(async () => {}), progress: vi.fn(async () => {}), end: vi.fn(async () => {}), tasteIntro: vi.fn(async () => {}), markRead: vi.fn(async () => {}) };

// user: { emailVerified }, profile: users/{uid} doc
async function renderFlow({ user = { uid: 'u', email: 'a@b.co', emailVerified: true }, profile = {}, isNew, native = false } = {}) {
  vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));
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
  vi.doMock('../lib/notifications', () => ({ markNotificationRead: saved.markRead }));
  vi.doMock('../lib/useWelcomeBonus', () => ({ useWelcomeBonus: () => ({ saveError: null, retry: () => {} }) }));
  vi.doMock('../components/OnboardingRateStep', () => ({
    default: ({ onDone, onLater, lovedTags }) => (
      <div>
        <p>RATE STEP loved:{lovedTags.join(',')}</p>
        <button onClick={onDone}>RATE DONE</button>
        <button onClick={onLater}>RATE LATER</button>
      </div>
    ),
  }));
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

  it('resumes a half-finished rate step, and maps the retired check-in step to it', async () => {
    for (const step of ['rate', 'checkin']) {
      const el = await renderFlow({
        profile: { onboardingVersion: ONBOARDING_VERSION, onboardingProgress: { version: ONBOARDING_VERSION, step } },
      });
      expect(el.textContent).toContain('RATE STEP');
      container.remove();
      vi.resetModules();
    }
  });
});

describe('Onboarding: existing user (account from before the flow existed)', () => {
  it('sees the updated-onboarding welcome, no email step, and can skip everything', async () => {
    const el = await renderFlow({ profile: { username: 'old-timer', onboardingCompleted: true } });
    expect(el.textContent).toContain('Onboarding has been updated');
    expect(el.textContent).not.toContain('Verify your email');

    await click(button(el, 'Skip'));
    expect(el.textContent).toContain('Anything else?');
    await click(button(el, 'Skip for now'));

    // What was answered is saved, but skipping the cards doesn't finish
    // onboarding, so the notification and banner stay. Then comes the rate step;
    // "Do this later" ends the flow (no "Always" location in a browser).
    expect(saved.results).toHaveBeenCalledTimes(1);
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: false });
    expect(el.textContent).toContain('RATE STEP');
    await click(button(el, 'RATE LATER'));
    expect(el.textContent).toContain("You're set for now");
    // Skipped every card: never "Mapr will use the 0 you answered".
    expect(el.textContent).not.toMatch(/use the 0/);
    expect(el.textContent).toContain('skipped the cards');
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
    });
    await click(button(el, 'Skip for now'));
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: true });
    await click(button(el, 'RATE DONE'));
    expect(el.textContent).toContain("You're all set");
  });

  // firestore.rules denies an update to a notification that doesn't exist, so
  // only an account that was actually sent the notice has one to mark read.
  it.each([
    ['was never sent the notice', {}, 0],
    ['was sent the notice', { onboardingNoticeVersion: ONBOARDING_VERSION }, 1],
  ])('finishing the cards marks the notice read only when the account %s', async (_label, extra, calls) => {
    const el = await renderFlow({
      profile: {
        onboardingCompleted: true,
        ...extra,
        onboardingProgress: {
          version: ONBOARDING_VERSION,
          step: 'notes',
          cardWords: ALL_SWIPE_CARDS.map((c) => c.word),
          answers: ALL_SWIPE_CARDS.map((c) => ({ word: c.word, answer: 'love' })),
        },
      },
    });
    await click(button(el, 'Skip for now'));
    expect(saved.markRead).toHaveBeenCalledTimes(calls);
  });

  it('never asks for a check-in: the step after the notes is rating places', async () => {
    const el = await renderFlow({ profile: { onboardingCompleted: true } });
    await click(button(el, 'Skip'));
    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('RATE STEP');
    expect(el.textContent).not.toMatch(/check-in/i);
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
    const el = await renderFlow({ user: { uid: 'u', email: 'new@user.co', emailVerified: false }, profile, isNew: true });
    expect(el.textContent).toContain('Verify your email');
    expect(el.textContent).toContain('new@user.co');
    expect(el.textContent).not.toContain("You're in!");
  });

  it('runs the flow once verified, ending with rating places and location', async () => {
    const el = await renderFlow({ profile, isNew: true });
    expect(el.textContent).toContain("You're in!");

    await click(button(el, 'Skip'));
    await click(button(el, 'Skip for now'));
    expect(saved.results).toHaveBeenCalledTimes(1);
    expect(saved.results.mock.calls[0][3]).toEqual({ complete: false });
    expect(el.textContent).toContain('RATE STEP');
  });

  it('passes the categories loved on the swipe cards to the rate step', async () => {
    const el = await renderFlow({
      profile: {
        onboardingSource: 'signup',
        onboardingProgress: { version: ONBOARDING_VERSION, step: 'notes', cardWords: ['Steak'], answers: [{ word: 'Steak', answer: 'love' }] },
      },
      isNew: true,
    });
    await click(button(el, 'Skip for now'));
    expect(el.textContent).toContain('loved:food');
  });
});

describe('Onboarding: "Always" location step', () => {
  const profile = { onboardingVersion: ONBOARDING_VERSION, onboardingProgress: { version: ONBOARDING_VERSION, step: 'rate' } };

  it('is skipped in a browser, where the plugin does not exist', async () => {
    const el = await renderFlow({ profile, isNew: true, native: false });
    await click(button(el, 'RATE DONE'));
    expect(el.textContent).not.toContain('LOCATION STEP');
  });

  it('is still offered in the iOS app', async () => {
    const el = await renderFlow({ profile, isNew: true, native: true });
    await click(button(el, 'RATE DONE'));
    expect(el.textContent).toContain('LOCATION STEP');
  });
});
