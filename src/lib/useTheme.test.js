// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyStoredTheme, getInitialTheme } from './useTheme';

describe('theme startup', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light for everyone, even with an old saved dark', () => {
    localStorage.setItem('lh-theme', 'dark');
    expect(getInitialTheme()).toBe('light');
    applyStoredTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies a dark choice made in Settings without opening Settings', () => {
    localStorage.setItem('lh-theme-v2', 'dark');
    applyStoredTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
