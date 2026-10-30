import { describe, it, expect } from 'vitest';
import { bubbleRadius, BUBBLE_MARGIN_METERS } from './landmarkBubble';

describe('bubbleRadius', () => {
  it('adds 30 m to the place\'s own check-in radius', () => {
    expect(bubbleRadius({ name: 'Art Deco Historic District', checkInRadiusMeters: 1500 })).toBe(1500 + BUBBLE_MARGIN_METERS);
  });
  it('uses the radius for its kind of place when none is set', () => {
    expect(bubbleRadius({ name: 'Liberty Bell', categories: ['history-culture'] })).toBe(60);
    expect(bubbleRadius({ name: 'Rittenhouse Square', categories: ['parks-nature'] })).toBe(180);
  });
  it('never returns less than the margin', () => {
    expect(bubbleRadius(null)).toBeGreaterThanOrEqual(BUBBLE_MARGIN_METERS);
  });
});
