import { describe, it, expect } from 'vitest';
import { createPositionCache } from './positionCache';

describe('createPositionCache', () => {
  it('returns the same array while the coordinates are unchanged', () => {
    const pos = createPositionCache();
    const a = pos('miami/south-beach', 25.78, -80.13);
    expect(pos('miami/south-beach', 25.78, -80.13)).toBe(a);
    expect(a).toEqual([25.78, -80.13]);
  });

  it('returns a new array when the coordinates move', () => {
    const pos = createPositionCache();
    const a = pos('k', 1, 2);
    const b = pos('k', 1, 3);
    expect(b).not.toBe(a);
    expect(b).toEqual([1, 3]);
    expect(pos('k', 1, 3)).toBe(b);
  });

  it('keeps keys separate', () => {
    const pos = createPositionCache();
    expect(pos('a', 1, 2)).not.toBe(pos('b', 1, 2));
  });
});
