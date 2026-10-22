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
});
