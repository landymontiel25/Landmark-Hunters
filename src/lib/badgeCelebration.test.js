import { describe, it, expect } from 'vitest';
import { claimFreshBadges, releaseBadges } from './badgeCelebration';

const badges = [{ id: 'expedition' }, { id: 'first-steps' }];
const never = () => false;

describe('claimFreshBadges', () => {
  it('returns badges the profile has no record of', () => {
    const claimed = new Set();
    const out = claimFreshBadges({ badges, known: { 'first-steps': 1 }, uid: 'u', celebrated: never, claimed });
    expect(out.map((b) => b.id)).toEqual(['expedition']);
  });

  it('claims a badge the first time, so re-runs while its write is in flight return nothing', () => {
    const claimed = new Set();
    const args = { badges, known: {}, uid: 'u', celebrated: never, claimed };
    expect(claimFreshBadges(args)).toHaveLength(2);
    expect(claimFreshBadges(args)).toHaveLength(0);
    expect(claimFreshBadges(args)).toHaveLength(0);
  });

  it('skips badges already celebrated on this device', () => {
    const claimed = new Set();
    const out = claimFreshBadges({ badges, known: {}, uid: 'u', celebrated: (u, id) => id === 'expedition', claimed });
    expect(out.map((b) => b.id)).toEqual(['first-steps']);
  });

  it('keeps accounts apart', () => {
    const claimed = new Set();
    claimFreshBadges({ badges, known: {}, uid: 'a', celebrated: never, claimed });
    expect(claimFreshBadges({ badges, known: {}, uid: 'b', celebrated: never, claimed })).toHaveLength(2);
  });

  it('lets a later run retry after a failed write', () => {
    const claimed = new Set();
    const args = { badges, known: {}, uid: 'u', celebrated: never, claimed };
    const first = claimFreshBadges(args);
    releaseBadges({ badges: first, uid: 'u', claimed });
    expect(claimFreshBadges(args)).toHaveLength(2);
  });
});
