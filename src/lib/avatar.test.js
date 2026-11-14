import { describe, it, expect } from 'vitest';
import { clampOffset, cropRect, avatarPath } from './avatar';

describe('profile picture crop (owner, 2026-11-14)', () => {
  const photo = { width: 3000, height: 4000 }; // a portrait iPhone photo
  it('centered at zoom 1 takes the middle square of the photo', () => {
    const { sx, sy, side } = cropRect(photo, 260, 1, 0, 0);
    expect(side).toBeCloseTo(3000);
    expect(sx).toBeCloseTo(0);
    expect(sy).toBeCloseTo(500);
  });
  it('zooming in takes a smaller square, still centered', () => {
    const { sx, sy, side } = cropRect(photo, 260, 2, 0, 0);
    expect(side).toBeCloseTo(1500);
    expect(sx).toBeCloseTo(750);
    expect(sy).toBeCloseTo(1250);
  });
  it('dragging the photo down shows more of its top, never past the edge', () => {
    const { y } = clampOffset(photo, 260, 1, 0, 10000);
    const { sy } = cropRect(photo, 260, 1, 0, y);
    expect(sy).toBeCloseTo(0);
    expect(clampOffset(photo, 260, 1, 500, 0).x).toBe(0); // no room sideways at zoom 1
  });
  it('one file per account', () => {
    expect(avatarPath('abc')).toBe('avatars/abc.jpg');
  });
});
