import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ux-3 bottom nav label size', () => {
  it('caps the label size without shrinking it below the theme size (0.7rem)', () => {
    const css = readFileSync(new URL('./ux-3.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.bottom-nav a \{[^}]*font-size: min\(0\.7rem, 12px\)/);
  });

  it('lets every tab be at least as wide as its label so "Landmarks" is not clipped (owner, 2026-11-08)', () => {
    const css = readFileSync(new URL('./ux-3.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.bottom-nav a \{\s*flex: 1 0 auto;/);
    expect(css).toMatch(/\.bottom-nav a > span:last-child \{\s*white-space: nowrap;/);
  });
});
