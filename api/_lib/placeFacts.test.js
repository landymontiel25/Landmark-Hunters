import { describe, it, expect } from 'vitest';
import { factsText, factsField } from './placeFacts.js';

describe('placeFacts', () => {
  it('joins facts as sentences, skipping the address', () => {
    expect(factsText({ facts: ['Opened in 1924', 'Has a dog park.', 'Address: 1 Main St, Miami'] })).toBe('Opened in 1924. Has a dog park.');
  });

  it('stops at a whole fact under the limit', () => {
    const t = factsText({ facts: ['a'.repeat(30), 'b'.repeat(30)] }, 50);
    expect(t).toBe(`${'a'.repeat(30)}.`);
  });

  it('is empty for a place without facts', () => {
    expect(factsText({})).toBe('');
    expect(factsField({ facts: ['Address: 1 Main St'] })).toBe('');
    expect(factsField({ facts: ['Built in 1925.'] })).toBe(' | facts: Built in 1925.');
  });
});
