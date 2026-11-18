import { describe, expect, it } from 'vitest';
import { namesMatchLoose, namesMatch } from './placeLookup.js';

describe('namesMatchLoose (the photo lookup second try)', () => {
  it('takes a name Google writes with an extra or missing word', () => {
    expect(namesMatch("Morgan's", 'Morgans Restaurant Wynwood')).toBe(false);
    expect(namesMatchLoose("Morgan's", 'Morgans Restaurant Wynwood')).toBe(true);
    expect(namesMatchLoose('Rose skybar', 'Rose Skybar Miami Beach')).toBe(true);
    expect(namesMatchLoose('Alejandra von Hartz Gallery', 'Alejandra von Hartz')).toBe(true);
  });

  it('never takes a place sharing only a kind of place or a common word', () => {
    expect(namesMatchLoose('Liberty Bell', 'Liberty Gift Shop')).toBe(false);
    expect(namesMatchLoose('Fado', 'Fado Irish Pub')).toBe(false); // a one-word name needs 5+ letters
    expect(namesMatchLoose('The Continental', 'Continental Restaurant')).toBe(true);
    expect(namesMatchLoose('Central Park', 'Park Cafe')).toBe(false);
    expect(namesMatchLoose('Ogyu', 'Sushi Bar')).toBe(false);
  });
});
