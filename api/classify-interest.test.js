import { describe, it, expect } from 'vitest';
import { parseClassification } from './classify-interest.js';

const valid = new Set(['paris/eiffel', 'paris/louvre', 'rome/colosseum']);

describe('classify-interest parseClassification', () => {
  it('reads a complete reply and drops invented ids', () => {
    const raw = '{"matches": ["paris/eiffel", "x/fake"], "emoji": "\u{1F5FC}"}';
    expect(parseClassification(raw, valid, 'end_turn')).toEqual({ matches: ['paris/eiffel'], emoji: '\u{1F5FC}' });
  });

  it('keeps the matches written before a max_tokens cut instead of returning nothing', () => {
    const raw = '{"matches": ["paris/eiffel", "paris/louvre", "rome/colos';
    const r = parseClassification(raw, valid, 'max_tokens');
    expect(r.matches).toEqual(['paris/eiffel', 'paris/louvre']);
  });

  it('reports failure (null) for unusable output rather than an empty match list', () => {
    expect(parseClassification('{"matches": ["rome/col', valid, 'max_tokens')).toBeNull();
    expect(parseClassification('Sorry, I cannot', valid, 'end_turn')).toBeNull();
  });
});
