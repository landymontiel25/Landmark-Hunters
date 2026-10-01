// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ONBOARDING_VERSION } from './onboardingVersion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

const send = vi.fn(async () => {});
const resurface = vi.fn(async () => {});

async function mount(profile) {
  const auth = { user: { uid: 'u' } };
  const friends = { myProfile: profile, profileFresh: true };
  vi.doMock('./AuthContext', () => ({ useAuth: () => auth }));
  vi.doMock('./FriendsContext', () => ({ useFriends: () => friends }));
  vi.doMock('./onboardingSave', () => ({ sendOnboardingNotice: send, resurfaceOnboardingNotice: resurface }));
  const { useOnboardingNotice } = await import('./useOnboardingNotice');
  function Probe() {
    useOnboardingNotice();
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<Probe />));
}

describe('bell alert for unfinished swipe cards', () => {
  it('is created for an account that has not finished them', async () => {
    await mount({ onboardingSource: 'signup-skipped' });
    expect(send).toHaveBeenCalledWith('u');
    expect(resurface).not.toHaveBeenCalled();
  });

  it('comes back unread every session until the cards are finished', async () => {
    await mount({ onboardingVersion: 0, onboardingNoticeVersion: ONBOARDING_VERSION });
    expect(resurface).toHaveBeenCalledWith('u');
    expect(send).not.toHaveBeenCalled();
  });

  it('is not raised for an account that finished the current version', async () => {
    await mount({ onboardingVersion: ONBOARDING_VERSION, onboardingNoticeVersion: ONBOARDING_VERSION });
    expect(send).not.toHaveBeenCalled();
    expect(resurface).not.toHaveBeenCalled();
  });
});
