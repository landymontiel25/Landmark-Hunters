import { describe, it, expect } from 'vitest';
import { shouldResetScroll } from './scrollReset';

describe('shouldResetScroll', () => {
  it('resets on a fresh navigation into a main tab', () => {
    expect(shouldResetScroll('/landmarks', 'PUSH')).toBe(true);
    expect(shouldResetScroll('/profile', 'REPLACE')).toBe(true);
  });
  it('leaves Back/Forward alone so lists can restore themselves', () => {
    expect(shouldResetScroll('/landmarks', 'POP')).toBe(false);
  });
  it('ignores non-tab screens', () => {
    expect(shouldResetScroll('/checkins', 'PUSH')).toBe(false);
  });
});
