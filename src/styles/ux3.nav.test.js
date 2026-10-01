import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ux-3 bottom nav label size', () => {
  it('caps the label size without shrinking it below the theme size (0.7rem)', () => {
    const css = readFileSync(new URL('./ux-3.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.bottom-nav a \{[^}]*font-size: min\(0\.7rem, 12px\)/);
  });
});
