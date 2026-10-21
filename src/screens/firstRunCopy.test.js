import { describe, it, expect } from 'vitest';
import { COPY } from './firstRunCopy';

// Guide T15: no em dashes in new copy; hints under 12 words.
const strings = (v) =>
  typeof v === 'string' ? [v] : typeof v === 'function' ? [v('240 ft', '98 ft')] : Object.values(v).flatMap(strings);

describe('Tutorial 2 copy (T15)', () => {
  it('has no em dashes', () => {
    for (const s of strings(COPY)) expect(s).not.toMatch(/—/);
  });

  it('keeps the swipe hint under 12 words', () => {
    expect(COPY.swipe.hint.split(/\s+/).length).toBeLessThan(12);
  });
});
