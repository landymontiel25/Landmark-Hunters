import { describe, it, expect } from 'vitest';
import { SPECIAL_PLACES, applySpecialPlace, specialPlace } from './specialPlaces.js';
import { registerPlaces, getLandmark } from './regions.js';

describe('special places', () => {
  it('the Alhambra Water Tower is the first landmark ever, worth 1,000 points', () => {
    const s = specialPlace('miami', 'osm-w435585913');
    expect(s).toMatchObject({ name: 'Alhambra Water Tower', bonusPoints: 1000 });
    expect(s.note).toContain('first landmark ever added to Landmark Hunters');
    expect(s.note).not.toMatch(/—/);
  });

  it('puts the note at the start of the description, once, and the bonus on the place', () => {
    const p = { id: 'osm-w435585913', region: 'miami', summary: 'Historic site on Alhambra Circle, Coral Gables.' };
    applySpecialPlace(p);
    applySpecialPlace(p);
    expect(p.summary).toBe(`${SPECIAL_PLACES['miami/osm-w435585913'].note} Historic site on Alhambra Circle, Coral Gables.`);
    expect(p.landmarkBonus).toBe(1000);
    const other = { id: 'x', region: 'miami', summary: 'Plain.' };
    expect(applySpecialPlace(other)).toEqual({ id: 'x', region: 'miami', summary: 'Plain.' });
  });

  it('applies when the place loads from its pack', () => {
    registerPlaces([{ id: 'osm-w435585913', region: 'miami', name: 'Alhambra Water Tower', lat: 25.752712, lng: -80.284978, categories: ['history-culture'], summary: 'Historic site on Alhambra Circle, Coral Gables.', facts: [] }]);
    const lm = getLandmark('miami', 'osm-w435585913');
    expect(lm.summary.startsWith('The first landmark ever added to Landmark Hunters')).toBe(true);
    expect(lm.landmarkBonus).toBe(1000);
  });
});
