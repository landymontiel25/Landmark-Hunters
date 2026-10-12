import { describe, expect, it } from 'vitest';
import { CITY_GROUPS, inScope, scopeFromKey, scopeRows } from './cityScope';

const keys = (q) => scopeRows(q).map((r) => r.key);

describe('city scopes', () => {
  it('groups US cities by state and the rest by country', () => {
    const ca = CITY_GROUPS.find((g) => g.label === 'California');
    expect(ca.regionIds.sort()).toEqual(['san-francisco', 'silicon-valley']);
    expect(CITY_GROUPS.find((g) => g.label === 'South Florida').regionIds).toEqual(['miami']);
    expect(CITY_GROUPS.find((g) => g.label === 'Spain').regionIds.length).toBe(3);
  });

  it('lists the states and countries with nothing typed', () => {
    const rows = scopeRows('');
    expect(rows[0].key).toBe('all');
    expect(rows.map((r) => r.primary)).toContain('California');
    expect(rows.map((r) => r.primary)).not.toContain('San Francisco');
  });

  it('finds cities by their state or province without asking Mapr', () => {
    expect(keys('western cape')).toContain('r:cape-town');
    expect(keys('california')).toEqual(expect.arrayContaining(['g:us-California', 'r:san-francisco', 'r:silicon-valley']));
  });

  it('finds a town inside a city and limits to it', () => {
    expect(keys('miami')[0]).toBe('a:miami:Miami');
    const miami = scopeFromKey('a:miami:Miami');
    expect(miami.label).toBe('Miami');
    expect(inScope({ regionId: 'miami', lat: 25.7743, lng: -80.1937 }, miami)).toBe(true); // downtown Miami
    expect(inScope({ regionId: 'miami', lat: 25.7907, lng: -80.13 }, miami)).toBe(false); // Miami Beach
    expect(inScope({ regionId: 'paris', lat: 25.7743, lng: -80.1937 }, miami)).toBe(false);
  });

  it('limits to a Silicon Valley town', () => {
    expect(keys('palo alto')[0]).toBe('a:silicon-valley:Palo Alto');
    const pa = scopeFromKey('a:silicon-valley:Palo Alto');
    expect(inScope({ regionId: 'silicon-valley', lat: 37.4419, lng: -122.143 }, pa)).toBe(true); // downtown Palo Alto
    expect(inScope({ regionId: 'silicon-valley', lat: 37.3861, lng: -122.0839 }, pa)).toBe(false); // Mountain View
  });

  it('reads old saved region ids and a whole state', () => {
    expect(scopeFromKey('miami').key).toBe('r:miami');
    expect(scopeFromKey('coral-gables').key).toBe('r:miami');
    expect(scopeFromKey('g:us-California').regionIds.length).toBe(2);
    expect(inScope({ regionId: 'silicon-valley', lat: 37.44, lng: -122.14 }, scopeFromKey('g:us-California'))).toBe(true);
  });
});
