import { describe, it, expect } from 'vitest';
import { MAX_PICKS, parseReasons, promptLines } from './pick-reasons.js';

describe('pick-reasons', () => {
  it('builds prompt lines only from real catalog landmarks, using the catalog text', () => {
    const { lines, keys } = promptLines([
      { region: 'villanova', id: 'st-thomas-of-villanova-church', pickType: 'usual' },
      { region: 'villanova', id: 'not-a-real-place', pickType: 'usual' },
      { region: 'villanova', id: 'the-villanova-grotto', pickType: 'new' },
      { region: 'villanova', id: 'st-thomas-of-villanova-church', chainFrom: 'food' },
    ]);
    expect([...keys]).toEqual(['villanova/st-thomas-of-villanova-church', 'villanova/the-villanova-grotto']);
    expect(lines[0]).toContain('St. Thomas of Villanova Church | History & Culture | usual');
    expect(lines[1]).toContain('| new |');
  });

  it('marks a chained pick with the category it follows', () => {
    const { lines } = promptLines([{ region: 'villanova', id: 'the-villanova-grotto', chainFrom: 'food' }]);
    expect(lines[0]).toContain('| chained | after Food |');
  });

  it(`caps the set at ${MAX_PICKS}`, () => {
    const many = Array.from({ length: 20 }, () => ({ region: 'villanova', id: 'the-villanova-grotto' }));
    expect(promptLines(many).lines.length).toBeLessThanOrEqual(MAX_PICKS);
  });

  it('keeps only reasons for keys it was asked about, and survives bad JSON', () => {
    const keys = new Set(['villanova/a']);
    expect(parseReasons('Sure! {"reasons": {"villanova/a": "Great view.", "villanova/zzz": "x"}}', keys)).toEqual({
      'villanova/a': 'Great view.',
    });
    expect(parseReasons('no json here', keys)).toEqual({});
  });
});
