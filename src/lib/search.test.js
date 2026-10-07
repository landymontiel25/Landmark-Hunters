import { describe, it, expect } from 'vitest';
import { matchesSearch } from './search';

describe('matchesSearch', () => {
  it('matches a plain single-word query as a substring', () => {
    expect(matchesSearch('Miami International Autodrome', 'autodrome')).toBe(true);
    expect(matchesSearch('Miami International Autodrome', 'monza')).toBe(false);
  });

  it('matches every word in a multi-word query regardless of order or adjacency', () => {
    const haystack = 'Miami International Autodrome miami formula 1 circuit f1 miami grand prix';
    expect(matchesSearch(haystack, 'miami f1')).toBe(true);
    expect(matchesSearch(haystack, 'f1 miami')).toBe(true);
  });

  it('requires ALL words to be present, not just any', () => {
    expect(matchesSearch('Eiffel Tower Paris', 'eiffel monza')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch('Miami International Autodrome', 'MIAMI autodrome')).toBe(true);
  });

  it('treats an empty or whitespace query as matching everything', () => {
    expect(matchesSearch('anything', '')).toBe(true);
    expect(matchesSearch('anything', '   ')).toBe(true);
  });

  it('handles missing haystack without throwing', () => {
    expect(matchesSearch(null, 'x')).toBe(false);
    expect(matchesSearch(undefined, '')).toBe(true);
  });
});

describe('matchesSearch typo tolerance', () => {
  it('forgives a missing, extra, wrong or swapped letter', () => {
    expect(matchesSearch('Eiffel Tower Paris', 'eifel')).toBe(true);
    expect(matchesSearch('Eiffel Tower Paris', 'towr')).toBe(true);
    expect(matchesSearch('Eiffel Tower Paris', 'eifel towr')).toBe(true);
    expect(matchesSearch('Liberty Bell Philadelphia', 'libetry')).toBe(true);
    expect(matchesSearch('Liberty Bell Philadelphia', 'philadelfia')).toBe(true);
    expect(matchesSearch('Colosseum Rome', 'coloseum')).toBe(true);
  });

  it('matches a half-typed word with a typo', () => {
    expect(matchesSearch('Independence Hall', 'indepen')).toBe(true);
    expect(matchesSearch('Independence Hall', 'indapend')).toBe(true);
  });

  it('ignores accents', () => {
    expect(matchesSearch('Café du Monde', 'cafe')).toBe(true);
    expect(matchesSearch('Cafe du Monde', 'café')).toBe(true);
  });

  it('does not stretch short words or unrelated ones', () => {
    expect(matchesSearch('Miami International Autodrome f1', 'f2')).toBe(false);
    expect(matchesSearch('Eiffel Tower Paris', 'rome')).toBe(false);
    expect(matchesSearch('Liberty Bell', 'library')).toBe(false);
    expect(matchesSearch('Wynwood Walls', 'hollywood')).toBe(false);
  });
});

describe('matchesSearch spelling by sound', () => {
  it('matches words spelled how they sound', () => {
    expect(matchesSearch('Philadelphia', 'filadelfia')).toBe(true);
    expect(matchesSearch('Colosseum', 'colloseum')).toBe(true);
  });
});

describe('searchScore', () => {
  it('is 0 when a word is missing everywhere', async () => {
    const { searchScore } = await import('./search');
    expect(searchScore('Liberty Bell Center', 'Philadelphia', 'eiffel')).toBe(0);
  });

  it('ranks a name match over a description match, and exact over typo', async () => {
    const { searchScore } = await import('./search');
    const inName = searchScore('Liberty Bell Center', 'Philadelphia icon', 'liberty bell');
    const inDetails = searchScore('Camparino', 'a bar with a liberty-style bell tower', 'liberty bell');
    const typo = searchScore('Liberty Bell Center', 'Philadelphia icon', 'libety bell');
    expect(inName).toBeGreaterThan(inDetails);
    expect(inName).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(inDetails);
  });
});

describe('gibberish', () => {
  it('does not match everything when repeated letters collapse the sound form', () => {
    expect(matchesSearch('Madrid royal palaces tapas', 'zzzzqqqq')).toBe(false);
    expect(matchesSearch('Madrid royal palaces tapas', 'aaaaaaaa')).toBe(false);
    expect(matchesSearch('Philadelphia', 'filadelfia')).toBe(true);
  });
});

describe('apostrophes', () => {
  it("treats a curly apostrophe (iPhone keyboard) and a straight one as the same", () => {
    expect(matchesSearch("Joe's Pizza", 'joe’s')).toBe(true);
    expect(matchesSearch('Joe’s Pizza', "joe's pizza")).toBe(true);
  });
});
