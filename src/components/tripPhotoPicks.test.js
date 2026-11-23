import { describe, it, expect } from 'vitest';
import { tripPhotoPicks } from './NewUI.jsx';

describe('tripPhotoPicks', () => {
  it('prefers stops with their own photo, then keeps trip order', () => {
    const a = { id: 'resort' };
    const b = { id: 'reef', images: [] };
    const c = { id: 'harbour', images: ['h.jpg'] };
    const d = { id: 'light', images: ['l.jpg'] };
    const e = { id: 'beach' };
    expect(tripPhotoPicks([a, b, c, d, e]).map((p) => p.id)).toEqual(['harbour', 'light', 'resort']);
    expect(tripPhotoPicks([a, b]).map((p) => p.id)).toEqual(['resort', 'reef']);
    expect(tripPhotoPicks([])).toEqual([]);
  });
});
