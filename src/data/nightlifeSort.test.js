import { describe, it, expect } from 'vitest';
import { ALL_LANDMARKS, INTERESTS } from './regions';
import { nightlifeHome } from './nightlifeSort';

const cat = (name) => ALL_LANDMARKS.find((l) => l.name === name)?.categories[0];

describe('Nightlife is only bars, clubs and live music', () => {
  it('puts aquariums, zoos and theme parks under Attractions', () => {
    expect(INTERESTS.find((i) => i.id === 'attractions')?.label).toBe('Attractions');
    for (const n of ['Zoo Miami', 'Jungle Island', 'Bronx Zoo', 'Coney Island', "California's Great America", 'Two Oceans Aquarium']) {
      expect(cat(n), n).toBe('attractions');
    }
  });

  it('puts theaters, opera houses and cinemas under Art & Culture', () => {
    for (const n of ['Adrienne Arsht Center', 'Teatro alla Scala', 'Palais Garnier', 'Carnegie Hall', 'Castro Theatre']) {
      expect(cat(n), n).toBe('history-culture');
    }
  });

  it('keeps bars, jazz clubs, music venues, cabaret and flamenco in Nightlife', () => {
    for (const n of ['Ball & Chain', 'Blue Note Jazz Club', 'The Fillmore', 'Great American Music Hall', 'Moulin Rouge', 'Corral de la Morería', "McSorley's Old Ale House"]) {
      expect(cat(n), n).toBe('local-life');
    }
  });

  it('sorts imported places by their topic, and keeps comedy clubs in Nightlife', () => {
    expect(nightlifeHome({ name: 'Some Aquarium', topic: 'aquarium' })).toBe('attractions');
    expect(nightlifeHome({ name: 'Arden Theatre', topic: 'theater' })).toBe('history-culture');
    expect(nightlifeHome({ name: 'Helium Comedy Club', topic: 'theater' })).toBeNull();
    expect(nightlifeHome({ name: 'Dive Bar', topic: 'bar' })).toBeNull();
  });

  it('files malls under Shopping', () => {
    for (const n of ['Bayside Marketplace', 'King of Prussia Mall', 'Lincoln Road', 'Santana Row']) expect(cat(n), n).toBe('shopping');
  });
});
