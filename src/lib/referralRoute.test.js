// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({}));
vi.mock('./firebase', () => ({ db: null }));
vi.mock('./friends', () => ({ findUserByUsername: vi.fn() }));
const { routeReferralLinkToSignup } = await import('./referrals');

describe('routeReferralLinkToSignup', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('sends an invite link on the home route to the sign-up form', () => {
    window.history.replaceState(null, '', '/?ref=sam');
    routeReferralLinkToSignup();
    expect(window.location.hash).toBe('#/profile?signup=1');
    expect(window.location.search).toBe('?ref=sam');
  });
  it('leaves a link that already names a screen alone', () => {
    window.history.replaceState(null, '', '/?ref=sam#/landmarks');
    routeReferralLinkToSignup();
    expect(window.location.hash).toBe('#/landmarks');
  });
  it('does nothing without a ref', () => {
    routeReferralLinkToSignup();
    expect(window.location.hash).toBe('');
  });
});
