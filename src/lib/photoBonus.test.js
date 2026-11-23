import { describe, expect, it } from 'vitest';
import { photoButtonLabel, photoBonusToast } from './photoBonus';

describe('photoButtonLabel', () => {
  it('adds +10 pts while the bonus is still open at this place', () => {
    expect(photoButtonLabel('Add photo (0/3)', true)).toBe('Add photo (0/3) · +10 pts');
  });
  it('leaves the label alone once paid', () => {
    expect(photoButtonLabel('Add photo (1/3)', false)).toBe('Add photo (1/3)');
  });
});

describe('photoBonusToast', () => {
  it('says the points on a paid photo', () => {
    expect(photoBonusToast({ awarded: 10 }).message).toContain('+10 pts');
  });
  it('a turned-down photo says what it showed, what it needed, and offers Try again', () => {
    const t = photoBonusToast({ awarded: 0, reason: 'photo-not-of-place', why: 'A screenshot of a map', expected: 'a photo of the resort or anywhere on it: the tennis courts' });
    expect(t.message).toBe('No photo bonus yet. A screenshot of a map. It needs a photo of the resort or anywhere on it: the tennis courts. Try again, or add another photo.');
    expect(t.retry).toBe(true);
  });
  it('never a silent no when the check could not run', () => {
    expect(photoBonusToast({ awarded: 0, reason: 'check-failed' })).toMatchObject({ retry: true });
    expect(photoBonusToast({ awarded: 0, reason: 'check-failed' }).message).toMatch(/Try again/);
  });
});
