// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyStoredTheme, getInitialTheme } from './useTheme';

describe('theme startup', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark, matching what the stylesheet renders', () => {
    expect(getInitialTheme()).toBe('dark');
    applyStoredTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies a saved light choice without opening Settings', () => {
    localStorage.setItem('lh-theme', 'light');
    applyStoredTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
