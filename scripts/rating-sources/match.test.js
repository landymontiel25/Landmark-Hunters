import { describe, it, expect } from 'vitest';
import { classifyMatch, nameOverlap } from './match.js';

const bell = { name: 'Liberty Bell Center', lat: 39.9496, lng: -75.1503, categories: ['history-culture'] };
const at = (m) => 39.9496 + m / 111195;

describe('classifyMatch', () => {
  it('is sure with one same-name place close by', () => {
    const out = classifyMatch(bell, [
      { id: 'A', name: 'Liberty Bell Center', lat: at(20), lng: bell.lng },
      { id: 'B', name: 'Independence Hall', lat: at(100), lng: bell.lng },
    ]);
    expect(out).toMatchObject({ status: 'sure', id: 'A' });
  });
  it('sends a same-name place too far away to review', () => {
    const out = classifyMatch(bell, [{ id: 'A', name: 'Liberty Bell Center', lat: at(600), lng: bell.lng }]);
    expect(out.status).toBe('review');
    expect(out.reason).toMatch(/600 m away/);
  });
  it('sends two same-name places to review', () => {
    const out = classifyMatch(bell, [
      { id: 'A', name: 'Liberty Bell Center', lat: at(10), lng: bell.lng },
      { id: 'B', name: 'Liberty Bell Center', lat: at(300), lng: bell.lng },
    ]);
    expect(out.status).toBe('review');
  });
  it('picks the exact name when sub-places also match', () => {
    const museum = { name: 'Philadelphia Museum of Art', lat: 39.9656, lng: -75.181, categories: ['art-museums'] };
    const out = classifyMatch(museum, [
      { id: 'M', name: 'Philadelphia Museum of Art', lat: 39.9656, lng: -75.181 },
      { id: 'S', name: 'Philadelphia Museum of Art Steps', lat: 39.9652, lng: -75.1802 },
    ]);
    expect(out).toMatchObject({ status: 'sure', id: 'M' });
    // No exact name among several matches: still review.
    expect(classifyMatch({ ...bell, name: 'Liberty Bell' }, [
      { id: 'A', name: 'Liberty Bell Center', lat: at(10), lng: bell.lng },
      { id: 'B', name: 'Liberty Bell Pavilion', lat: at(30), lng: bell.lng },
    ]).status).toBe('review');
  });
  it('sends a nearby similar name to review, never guesses', () => {
    const out = classifyMatch(bell, [{ id: 'A', name: 'Liberty Bell Gift Shop', lat: at(30), lng: bell.lng }]);
    expect(out.status).toBe('review');
  });
  it('none when nothing is close or alike', () => {
    expect(classifyMatch(bell, [{ id: 'A', name: 'Joe’s Pizza', lat: at(50), lng: bell.lng }]).status).toBe('none');
    expect(classifyMatch(bell, []).status).toBe('none');
  });
  it('allows a wider radius for parks', () => {
    const park = { name: 'Fairmount Park', lat: 39.98, lng: -75.2, topic: 'park' };
    const out = classifyMatch(park, [{ id: 'P', name: 'Fairmount Park', lat: 39.98 + 350 / 111195, lng: -75.2 }]);
    expect(out.status).toBe('sure');
  });
});

describe('nameOverlap', () => {
  it('scores shared words of the shorter name', () => {
    expect(nameOverlap('Liberty Bell', 'The Liberty Bell Center')).toBe(1);
    expect(nameOverlap('Liberty Bell', 'Bell Tower')).toBe(0.5);
  });
});
