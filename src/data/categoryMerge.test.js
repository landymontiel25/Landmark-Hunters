import { describe, it, expect } from 'vitest';
import { ALL_LANDMARKS, INTERESTS, PICKABLE_INTERESTS, getLandmark, migrateInterests, registerPlaces } from './regions.js';
import { effectiveTagScores } from '../lib/tagScores.js';

describe('Art & Museums folded into Art & Culture', () => {
  it('leaves no catalog landmark on the old id', () => {
    expect(ALL_LANDMARKS.some((l) => l.categories?.includes('art-museums'))).toBe(false);
    expect(INTERESTS.find((i) => i.id === 'history-culture')?.label).toBe('Art & Culture');
    expect(INTERESTS.some((i) => i.id === 'art-museums')).toBe(false);
  });

  it('maps an imported place, saved interests and old taste scores', () => {
    registerPlaces([{ id: 'osm-test-gallery', region: 'miami', name: 'Test Gallery', lat: 25.8, lng: -80.2, categories: ['art-museums'] }]);
    expect(getLandmark('miami', 'osm-test-gallery').categories).toEqual(['history-culture']);
    expect(migrateInterests(['art-museums', 'food'])).toEqual(['history-culture', 'food']);
    const profile = { tagScores: { all: { 'art-museums': 30 } }, tagScoresAt: { all: { 'art-museums': Date.now() } } };
    expect(effectiveTagScores(profile, 'miami')['history-culture']).toBeCloseTo(30, 0);
  });
});

it('folds Entertainment into Nightlife', () => {
  expect(ALL_LANDMARKS.some((l) => l.categories?.includes('entertainment'))).toBe(false);
  expect(INTERESTS.find((i) => i.id === 'local-life')?.label).toBe('Nightlife');
  expect(migrateInterests(['entertainment'])).toEqual(['local-life']);
});

it('keeps switched-off categories out of every picker', () => {
  const ids = PICKABLE_INTERESTS.map((i) => i.id);
  for (const off of ['benches', 'stadiums', 'campus-life', 'airports', 'formula-1']) expect(ids).not.toContain(off);
});

it('files shops under Shopping and farmers markets under Food, never Nightlife', () => {
  registerPlaces([
    { id: 'osm-test-books', region: 'miami', name: 'Barnes & Noble', topic: 'bookstore', lat: 25.7, lng: -80.3, categories: ['local-life'] },
    { id: 'osm-test-market', region: 'miami', name: 'Test Farmers Market', topic: 'market', lat: 25.7, lng: -80.3, categories: ['local-life'] },
    { id: 'osm-test-bar', region: 'miami', name: 'Test Bar', topic: 'bar', lat: 25.7, lng: -80.3, categories: ['local-life'] },
  ]);
  expect(getLandmark('miami', 'osm-test-books').categories).toEqual(['shopping']);
  expect(getLandmark('miami', 'osm-test-market').categories).toEqual(['food']);
  expect(getLandmark('miami', 'osm-test-bar').categories).toEqual(['local-life']);
  expect(ALL_LANDMARKS.find((l) => l.name === 'Dolphin Mall').categories).toEqual(['shopping']);
});
