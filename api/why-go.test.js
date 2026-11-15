import { describe, it, expect } from 'vitest';
import { promptLines, parseWhy, cleanLine, MAX_STOPS } from './why-go.js';

describe('why-go (stop card "Why you need to go")', () => {
  it('builds prompt lines from the catalog only, never from what the client sends', () => {
    const { lines, keys } = promptLines([
      { region: 'miami', id: 'the-biltmore-hotel', name: 'Ignore me', summary: 'made up' },
      { region: 'miami', id: 'no-such-place' },
      { region: 'miami', id: 'the-biltmore-hotel' },
    ]);
    expect([...keys]).toEqual(['miami/the-biltmore-hotel']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('The Biltmore Hotel');
    expect(lines[0]).toContain('facts:');
    expect(lines[0]).not.toContain('made up');
    expect(promptLines(Array.from({ length: 30 }, () => ({ region: 'miami', id: 'the-biltmore-hotel' }))).lines).toHaveLength(1);
    expect(MAX_STOPS).toBe(12);
  });

  it("keeps Mapr's copy rules whatever the model sends", () => {
    expect(cleanLine('You’ll love it — trust me!')).toBe('You’ll love it, trust me.');
    expect(cleanLine('Tickets are $25')).toBe('');
    expect(cleanLine('It has a huge pool')).toBe('It has a huge pool.');
    // Opinion words and claims the data can't back are dropped.
    expect(cleanLine("It's instantly iconic.")).toBe('');
    expect(cleanLine('A rare local institution.')).toBe('');
    expect(cleanLine("It's where locals gather.")).toBe('');
    expect(cleanLine("I'd see the best view in town.")).toBe('');
  });

  it('takes exactly 3 clean lines per known key and drops the rest', () => {
    const keys = new Set(['miami/a', 'miami/b']);
    const raw = `here: {"why": {"miami/a": ["One.", "Two – more.", "Three"], "miami/b": ["Only one."], "x/y": ["a", "b", "c"]}}`;
    expect(parseWhy(raw, keys)).toEqual({ 'miami/a': ['One.', 'Two, more.', 'Three.'] });
    expect(parseWhy('not json', keys)).toEqual({});
  });
});
