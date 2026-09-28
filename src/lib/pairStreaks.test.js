import { describe, it, expect } from 'vitest';
import { pairIdOf } from './pairStreaks';

describe('pairIdOf', () => {
  it('is order-independent, so either member computes the same doc id', () => {
    expect(pairIdOf('a', 'b')).toBe(pairIdOf('b', 'a'));
    expect(pairIdOf('uid1', 'uid2')).toBe('uid1_uid2');
  });
});
