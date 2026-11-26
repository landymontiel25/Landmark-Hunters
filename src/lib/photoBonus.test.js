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
  it('a photo that does not show the place says so plainly, with Retake (owner, 2026-11-25)', () => {
    const t = photoBonusToast({ awarded: 0, reason: 'photo-not-of-place', why: 'A screenshot of a map', expected: 'a photo of the resort or anywhere on it: the tennis courts' });
    expect(t.message).toBe("No photo bonus: your photo doesn't show the place. A screenshot of a map. It needs a photo of the resort or anywhere on it: the tennis courts. Take another one for the bonus.");
    expect(t.retake).toBe(true);
  });
  it('a check that could not run says nothing at all (it is retried in the background)', () => {
    expect(photoBonusToast({ awarded: 0, reason: 'check-failed' })).toBeNull();
  });
});
