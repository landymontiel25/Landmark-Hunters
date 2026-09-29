import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_VERSION,
  onboardingNoticeId,
  onboardingStatus,
  needsOnboardingNotice,
} from './onboardingVersion';

describe('onboardingStatus', () => {
  it('new user: signed up and never finished onboarding', () => {
    expect(onboardingStatus({ onboardingSource: 'signup' })).toBe('new');
    expect(onboardingStatus({ onboardingSource: 'signup', onboardingVersion: 0 })).toBe('new');
  });

  it('existing user: an account with no onboarding version at all', () => {
    expect(onboardingStatus({ username: 'old-timer', onboardingCompleted: true })).toBe('update');
    expect(onboardingStatus({})).toBe('update');
    expect(onboardingStatus(null)).toBe('update');
  });

  it('completed user: finished the current version', () => {
    expect(onboardingStatus({ onboardingVersion: ONBOARDING_VERSION })).toBe('complete');
    expect(onboardingStatus({ onboardingSource: 'signup', onboardingVersion: ONBOARDING_VERSION })).toBe('complete');
  });

  it('bumping the version turns completed users into "update", even ones who signed up through the app', () => {
    expect(onboardingStatus({ onboardingVersion: 1 }, 2)).toBe('update');
    expect(onboardingStatus({ onboardingSource: 'signup', onboardingVersion: 1 }, 2)).toBe('update');
    expect(onboardingStatus({ onboardingVersion: 2 }, 2)).toBe('complete');
    expect(onboardingStatus({ onboardingVersion: 3 }, 2)).toBe('complete');
  });
});

describe('needsOnboardingNotice', () => {
  it('existing users get it once', () => {
    expect(needsOnboardingNotice({})).toBe(true);
    expect(needsOnboardingNotice({ onboardingNoticeVersion: ONBOARDING_VERSION })).toBe(false);
  });

  it('new users do not: they run the flow instead', () => {
    expect(needsOnboardingNotice({ onboardingSource: 'signup' })).toBe(false);
  });

  it('completed users do not', () => {
    expect(needsOnboardingNotice({ onboardingVersion: ONBOARDING_VERSION })).toBe(false);
  });

  it('bumping the version notifies everyone again, including users already notified about the old one', () => {
    expect(needsOnboardingNotice({ onboardingVersion: 1, onboardingNoticeVersion: 1 }, 2)).toBe(true);
    expect(needsOnboardingNotice({ onboardingNoticeVersion: 1 }, 2)).toBe(true);
    expect(needsOnboardingNotice({ onboardingVersion: 2, onboardingNoticeVersion: 2 }, 2)).toBe(false);
  });

  it('uses a different notification id per version', () => {
    expect(onboardingNoticeId(1)).not.toBe(onboardingNoticeId(2));
  });
});
