import { describe, expect, it } from 'vitest';
import { isIslandPlace } from './islands';
import { getLandmark } from '../data/regions';

describe('isIslandPlace (red map pins)', () => {
  it('counts every Abacos cay and Key Biscayne / Virginia Key', () => {
    expect(isIslandPlace({ ...getLandmark('abacos', 'elbow-reef-lighthouse'), regionId: 'abacos' })).toBe(true);
    expect(isIslandPlace({ ...getLandmark('abacos', 'abaco-beach-resort'), regionId: 'abacos' })).toBe(true);
    expect(isIslandPlace({ ...getLandmark('miami', 'crandon-park'), regionId: 'miami' })).toBe(true);
    expect(isIslandPlace({ ...getLandmark('miami', 'virginia-key-beach'), regionId: 'miami' })).toBe(true);
  });
  it('leaves mainland places (and the causeway) blue', () => {
    expect(isIslandPlace({ ...getLandmark('miami', 'the-biltmore-hotel'), regionId: 'miami' })).toBe(false);
    expect(isIslandPlace({ ...getLandmark('miami', 'rickenbacker-causeway'), regionId: 'miami' })).toBe(false);
    expect(isIslandPlace(null)).toBe(false);
  });
});
