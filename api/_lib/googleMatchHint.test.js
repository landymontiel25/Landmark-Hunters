import { describe, expect, it } from 'vitest';
import { googleMatchFor } from './googleMatchHint.js';

describe('googleMatchFor', () => {
  it("gives a landmark's own Google name and distance", () => {
    expect(googleMatchFor('abacos', 'nippers', 'Nippers')).toEqual({ name: "Nipper's Beach Bar & Grill", withinMeters: 3000 });
  });
  it('only when the request names the landmark by its catalog name', () => {
    expect(googleMatchFor('abacos', 'nippers', 'Somewhere else')).toBeNull();
  });
  it('is null for a landmark without one', () => {
    expect(googleMatchFor('abacos', 'tahiti-beach', 'Tahiti Beach')).toBeNull();
    expect(googleMatchFor('miami', 'nope', 'Nope')).toBeNull();
  });
});
