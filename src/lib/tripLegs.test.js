import { describe, it, expect } from 'vitest';
import { LEG_COLORS, laterLegs, legColor } from './tripLegs';

describe('trip legs', () => {
  it('gives each leg its own color, matching the stop it reaches', () => {
    expect(legColor(1)).toBe(LEG_COLORS[0]);
    expect(legColor(2)).not.toBe(legColor(1));
    expect(legColor(LEG_COLORS.length + 1)).toBe(LEG_COLORS[0]);
  });

  it('draws a line from the current stop to each later stop in order', () => {
    const a = { lat: 1, lng: 1 };
    const b = { lat: 2, lng: 2, n: 2 };
    const c = { lat: 3, lng: 3, n: 3 };
    const legs = laterLegs(a, [b, c], 1);
    expect(legs.map((l) => l.n)).toEqual([2, 3]);
    expect(legs[0].positions).toEqual([[1, 1], [2, 2]]);
    expect(legs[1].positions).toEqual([[2, 2], [3, 3]]);
    expect(legs[1].color).toBe(legColor(3));
  });
});
