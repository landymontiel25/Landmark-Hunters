import { describe, it, expect } from 'vitest';
import { adoptResolvedName } from './adoptResolvedName';

describe('adoptResolvedName', () => {
  it('adopts the full name when the typed one is a whole-word prefix', () => {
    expect(adoptResolvedName('Tapia', 'Tapia Peruvian Restaurant')).toBe(true);
    expect(adoptResolvedName('tapia', 'Tapia Peruvian Restaurant')).toBe(true);
    expect(adoptResolvedName('', 'Anything')).toBe(true);
  });
  it('keeps a short typed name that is only a partial word or a middle substring', () => {
    expect(adoptResolvedName('Bar', 'Barnes & Noble')).toBe(false);
    expect(adoptResolvedName('Pizza', "Joe's Pizza Palace")).toBe(false);
    expect(adoptResolvedName('Tapia', '')).toBe(false);
  });
});
