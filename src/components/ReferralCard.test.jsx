// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./PhoneVerify', () => ({ default: () => null }));
vi.mock('../lib/referrals', () => ({
  claimMyReferralBonuses: async () => [],
  referralNeed: () => null,
  REFERRAL_BONUS_POINTS: 50,
  referralLink: (u) => `https://landmarkhunters.com/?ref=${u}`,
  countMyReferrals: vi.fn(() => Promise.resolve({ joined: 2, paid: 1 })),
}));
const ReferralCard = (await import('./ReferralCard')).default;

describe('ReferralCard', () => {
  it('shows the link and joined count, and shares it', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<ReferralCard uid="u1" myUsername="sam" />));
    expect(el.querySelector('[data-testid="rf-link"]').textContent).toBe('landmarkhunters.com/?ref=sam');
    expect(el.textContent).toContain('2 friends have joined');
    await act(async () => el.querySelector('.rf-btn-primary').click());
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://landmarkhunters.com/?ref=sam' }));
    await act(async () => root.unmount());
  });
});
