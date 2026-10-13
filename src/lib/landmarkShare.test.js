import { describe, it, expect } from 'vitest';
import { landmarkShareText, landmarkShareUrl } from './landmarkShare';

describe('landmark share', () => {
  it('names the place and city, says what it is, and links a map', () => {
    const t = landmarkShareText({ id: 'x', name: 'Vizcaya', summary: 'A bayfront estate.', lat: 25.74, lng: -80.21 }, 'miami');
    expect(t).toMatch(/^📍 Vizcaya, Miami/);
    expect(t).toContain('A bayfront estate.');
    expect(t).toContain('https://www.google.com/maps/search/?api=1&query=25.74,-80.21');
  });

  it('links the place page in the app', () => {
    expect(landmarkShareUrl('miami', 'vizcaya')).toMatch(/\/#\/landmarks\/miami\/vizcaya$/);
  });
});
