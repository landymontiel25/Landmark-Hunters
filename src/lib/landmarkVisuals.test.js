import { describe, expect, it } from 'vitest';
import { landmarkIcon, sportIconFor } from './landmarkVisuals';

describe('sportIconFor', () => {
  it('names the sport when the name or kind says it', () => {
    expect(sportIconFor({ name: 'Granada Golf Course', categories: ['sports'] })).toBe('\u{26F3}');
    expect(sportIconFor({ name: 'Neil Schiff Tennis Center', categories: ['sports'] })).toBe('\u{1F3BE}');
    expect(sportIconFor({ name: 'Phelps Field', topic: 'soccer field', categories: ['sports'] })).toBe('\u{26BD}');
    expect(sportIconFor({ name: 'Ippodromo di San Siro', categories: ['stadiums'] })).toBe('\u{1F3C7}');
  });

  it('leaves other places and unnamed sports alone', () => {
    expect(sportIconFor({ name: 'Yankee Stadium', categories: ['stadiums'] })).toBeNull();
    expect(sportIconFor({ name: 'Golf Club Bar', categories: ['local-life'] })).toBeNull();
    expect(landmarkIcon({ name: 'Yankee Stadium', categories: ['stadiums'] })).toBe('\u{1F3DF}\u{FE0F}');
    expect(landmarkIcon({ name: 'Granada Golf Course', categories: ['sports'] })).toBe('\u{26F3}');
  });
});
