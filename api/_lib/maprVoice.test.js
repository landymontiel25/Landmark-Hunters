import { describe, it, expect } from 'vitest';
import { noDashes } from './maprVoice.js';

describe('Mapr never writes a dash between clauses (owner, 2026-11-14)', () => {
  it('turns em dashes and double hyphens into commas', () => {
    expect(noDashes('Sure -- tap how it sounds.')).toBe('Sure, tap how it sounds.');
    expect(noDashes('Try Joe’s — it’s close.')).toBe('Try Joe’s, it’s close.');
    expect(noDashes('Open late – great for tonight')).toBe('Open late, great for tonight');
    expect(noDashes('Go now —')).toBe('Go now');
  });
  it('leaves hyphenated words and plain text alone', () => {
    expect(noDashes('A well-known spot, 5-minute walk.')).toBe('A well-known spot, 5-minute walk.');
    expect(noDashes(null)).toBe(null);
  });
});
