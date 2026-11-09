import { describe, expect, it } from 'vitest';
import { appleScreenFor } from './appleRoutes';

describe('appleScreenFor', () => {
  it('covers Map, Landmarks, Itinerary and Profile', () => {
    expect(appleScreenFor('/')).toBe('map');
    expect(appleScreenFor('/landmarks')).toBe('landmarks');
    expect(appleScreenFor('/itinerary')).toBe('itinerary');
    expect(appleScreenFor('/profile')).toBe('profile');
    expect(appleScreenFor('/account')).toBe('profile');
  });
  it('never covers Mapr or other screens', () => {
    expect(appleScreenFor('/mapr')).toBeNull();
    expect(appleScreenFor('/mapr/anything')).toBeNull();
    expect(appleScreenFor('/settings')).toBeNull();
    expect(appleScreenFor('/landmarks/miami/1')).toBeNull();
    expect(appleScreenFor('/leaderboard/full')).toBeNull();
  });
});
