import { describe, it, expect } from 'vitest';
import { landmarkCountText } from './landmarkCountText';

describe('landmarkCountText', () => {
  it('says "All" only when nothing narrows the list', () => {
    expect(landmarkCountText({ count: 40 })).toMatch(/^All 40 landmarks/);
    expect(landmarkCountText({ count: 7, searching: true })).not.toMatch(/All/);
    expect(landmarkCountText({ count: 7, cityFiltered: true })).not.toMatch(/All/);
  });
  it('handles singular and empty', () => {
    expect(landmarkCountText({ count: 1, searching: true })).toMatch(/^1 landmark shown/);
    expect(landmarkCountText({ count: 1 })).not.toMatch(/1 landmarks/);
    expect(landmarkCountText({ count: 0 })).not.toMatch(/All 0/);
    expect(landmarkCountText({ count: 0, searching: true })).toMatch(/No landmarks match/);
    expect(landmarkCountText({ count: 1, matchingInterests: true })).toMatch(/^1 landmark matching/);
  });
});
