import { describe, it, expect } from 'vitest';
import { fmtVisitMinutes, placeSummary } from './itineraryCard';

describe('itinerary card text', () => {
  it('formats the time the stops take', () => {
    expect(fmtVisitMinutes(0)).toBe('');
    expect(fmtVisitMinutes(45)).toBe('45 min');
    expect(fmtVisitMinutes(60)).toBe('1 h');
    expect(fmtVisitMinutes(135)).toBe('2 h 15 min');
  });
  it('lists the first places and counts the rest', () => {
    expect(placeSummary([])).toBe('');
    expect(placeSummary(['A', 'B'])).toBe('A, B');
    expect(placeSummary(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C +2');
    expect(placeSummary(['A', '', null, 'B'])).toBe('A, B');
  });
});
