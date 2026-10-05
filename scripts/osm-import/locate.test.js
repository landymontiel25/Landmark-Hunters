import { describe, it, expect } from 'vitest';
import { parseAddress, streetKey, sameName, addressMatches, nearAddress, pickMatch, placeLike, areaOf, tagsOf, elementOf, extraKind, viewbox } from './locate.js';
import { importRegion } from './regions.js';

const zuni = {
  osm_type: 'way',
  osm_id: 256730304,
  lat: '37.7735636',
  lon: '-122.4216460',
  category: 'amenity',
  type: 'restaurant',
  importance: 0.29,
  name: 'Zuni Café',
  address: { house_number: '1658', road: 'Market Street', city: 'San Francisco' },
  extratags: { website: 'https://zunicafe.com/', wikidata: 'Q8075291', building: 'yes' },
  namedetails: { name: 'Zuni Café' },
  boundingbox: ['37.7734751', '37.7736884', '-122.4217296', '-122.4214473'],
};

describe('addresses', () => {
  it('reads the house number and street', () => {
    expect(parseAddress('1658 Market St, San Francisco, CA 94102')).toEqual({ number: '1658', street: 'Market St' });
    expect(parseAddress('3150 18th St #101')).toEqual({ number: '3150', street: '18th St' });
    expect(parseAddress('1-3 Embarcadero Center, Suite 2')).toEqual({ number: '1', street: 'Embarcadero Center' });
    expect(parseAddress('Bernal Heights Blvd')).toEqual({ number: null, street: 'Bernal Heights Blvd' });
    expect(parseAddress('Vallejo St at Taylor St')).toEqual({ number: null, street: 'Vallejo St', cross: ['Taylor St'] });
    expect(parseAddress('16th Ave between Kirkham St and Lawton St')).toEqual({ number: null, street: '16th Ave', cross: ['Kirkham St', 'Lawton St'] });
    expect(parseAddress(null)).toEqual({ number: null, street: null });
  });
  it('treats street abbreviations as the same street', () => {
    expect(streetKey('Market Street')).toBe(streetKey('Market St.'));
    expect(streetKey('Third Street')).toBe(streetKey('3rd St'));
    expect(streetKey('Valencia Street')).not.toBe(streetKey('Valencia Avenue'));
  });
  it("matches the OSM object's own address", () => {
    expect(addressMatches(parseAddress('1658 Market St'), zuni)).toBe(true);
    expect(addressMatches(parseAddress('1660 Market St'), zuni)).toBe(false);
    expect(addressMatches(parseAddress('1658 Mission St'), zuni)).toBe(false);
    expect(addressMatches(parseAddress('Market St'), zuni)).toBe(false);
    const park = { category: 'leisure', address: { road: 'Taylor Street' } };
    expect(addressMatches(parseAddress('Vallejo St at Taylor St'), park)).toBe(true);
    expect(addressMatches(parseAddress('Vallejo St at Mason St'), park)).toBe(false);
    expect(addressMatches(parseAddress('Taylor St'), { ...park, category: 'amenity' })).toBe(false);
  });
});

describe('names', () => {
  it('ignores accents, case and a leading "The"', () => {
    expect(sameName('Zuni Cafe', 'Zuni Café')).toBe(true);
    expect(sameName('The Interval', 'Interval')).toBe(true);
  });
  it('lets a long enough name sit inside the other', () => {
    expect(sameName('Tartine Bakery', 'Tartine')).toBe(true);
    expect(sameName('Nopa', 'Nopalito')).toBe(false);
    expect(sameName('Liholiho Yacht Club', 'Liholiho')).toBe(true);
    expect(sameName('Roxie Theater', 'Roxie')).toBe(true);
    expect(sameName('Borderlands Books', 'Borderlands Cafe')).toBe(false);
    expect(sameName('Borderlands Books', 'Borderlands Books SF')).toBe(true);
    expect(sameName('Bar Crudo', 'Bar Agricole')).toBe(false);
    expect(sameName('The Interval Bar', 'Bar')).toBe(false);
  });
});

describe('pickMatch', () => {
  const candidate = { name: 'Zuni Cafe', address: '1658 Market St' };
  it('takes the named object at the researched address', () => {
    const m = pickMatch(candidate, [zuni]);
    expect(m.status).toBe('FOUND');
    expect(m.how).toBe('osm address');
  });
  it('drops a same-name object elsewhere', () => {
    expect(pickMatch({ name: 'Zuni Cafe', address: '99 Valencia St' }, [zuni]).status).toBe('NOT_FOUND');
  });
  it('drops an object with another name at the address', () => {
    expect(pickMatch({ name: 'Rich Table', address: '1658 Market St' }, [zuni]).why).toBe('no OSM object with this name');
  });
  it('accepts an object within 75 m of the geocoded address', () => {
    const noAddr = { ...zuni, address: { city: 'San Francisco' } };
    expect(pickMatch(candidate, [noAddr], { geo: { lat: 37.7738, lng: -122.4212 } }).status).toBe('FOUND');
    expect(pickMatch(candidate, [noAddr], { geo: { lat: 37.7765, lng: -122.4216 } }).status).toBe('NOT_FOUND');
  });
  it('accepts an area whose bounds hold the geocoded address', () => {
    const park = { ...zuni, category: 'leisure', type: 'park', name: 'Bernal Heights Park', namedetails: { name: 'Bernal Heights Park' }, address: {}, lat: '37.743', lon: '-122.414', boundingbox: ['37.739', '37.747', '-122.419', '-122.409'] };
    expect(pickMatch({ name: 'Bernal Heights Park', address: 'Bernal Heights Blvd' }, [park], { geo: { lat: 37.7405, lng: -122.4176 } }).status).toBe('FOUND');
    expect(nearAddress({ ...park, osm_type: 'node' }, { lat: 37.7405, lng: -122.4176 })).toBe(false);
  });
  it('skips streams, roads and huge areas that share the name', () => {
    const stream = { ...zuni, osm_type: 'relation', category: 'waterway', type: 'stream', name: 'Stevens Creek', namedetails: { name: 'Stevens Creek' }, address: {}, boundingbox: ['37.2', '37.45', '-122.2', '-122.0'] };
    expect(pickMatch({ name: 'Stevens Creek County Park', address: '11401 Stevens Canyon Rd' }, [stream], { geo: { lat: 37.3, lng: -122.07 } }).why).toBe('no OSM object with this name');
    const bigPark = { ...stream, category: 'leisure', type: 'park' };
    expect(nearAddress(bigPark, { lat: 37.3, lng: -122.07 })).toBe(false);
    expect(placeLike({ category: 'building', extratags: { historic: 'building' } })).toBe(true);
    expect(placeLike({ category: 'building', extratags: {} })).toBe(false);
  });
  it('drops a match outside the region', () => {
    expect(pickMatch(candidate, [zuni], { inArea: () => false }).why).toBe('outside the region');
  });
  it('prefers the listed kind over its building', () => {
    const building = { ...zuni, osm_id: 1, category: 'building', type: 'yes', importance: 0.5 };
    expect(pickMatch(candidate, [building, zuni]).result.osm_id).toBe(256730304);
  });
});

describe('regions', () => {
  const sf = importRegion('sf');
  const sv = importRegion('sv');
  it('keeps San Francisco to the city inside its shape', () => {
    expect(areaOf(sf, zuni)).toBe('San Francisco');
    expect(areaOf(sf, { ...zuni, address: { city: 'Daly City' } })).toBe(null);
  });
  it('names the Silicon Valley town, and downtown San Jose only inside its shape', () => {
    expect(areaOf(sv, { lat: '37.4443', lon: '-122.1611', address: { city: 'Palo Alto' } })).toBe('Palo Alto');
    expect(areaOf(sv, { lat: '37.3352', lon: '-121.8909', address: { city: 'San Jose' } })).toBe('Downtown San Jose');
    expect(areaOf(sv, { lat: '37.3022', lon: '-121.8492', address: { city: 'San Jose' } })).toBe(null);
    expect(areaOf(sv, { lat: '37.6', lon: '-122.4', address: { city: 'San Mateo' } })).toBe(null);
  });
  it('builds a Nominatim viewbox from the shape', () => {
    expect(viewbox([[1, 2], [3, 4]])).toBe('2,3,4,1');
  });
});

describe('elements', () => {
  it("rebuilds OSM tags from the result, with the researched address", () => {
    const tags = tagsOf(zuni, parseAddress('1658 Market St'), 'San Francisco');
    expect(tags).toMatchObject({ amenity: 'restaurant', name: 'Zuni Café', wikidata: 'Q8075291', 'addr:housenumber': '1658', 'addr:street': 'Market Street', 'addr:city': 'San Francisco' });
  });
  it('gives kinds the pull rules lack', () => {
    expect(extraKind({ shop: 'coffee' }).topic).toBe('café');
    expect(extraKind({ amenity: 'restaurant' })).toBe(null);
    const el = elementOf({ ...zuni, category: 'shop', type: 'coffee' }, { candidate: { name: 'Zuni Cafe', address: '1658 Market St' }, town: 'San Francisco', city: 'San Francisco' });
    expect(el).toMatchObject({ type: 'way', id: 256730304, town: 'San Francisco', kind: { category: 'food' } });
  });
});
