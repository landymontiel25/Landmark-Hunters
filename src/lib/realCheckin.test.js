import { describe, it, expect } from 'vitest';
import { oneVisitPerDay } from './realCheckin';

// Owner, 2026-10-18: Budare Bistro showed twice after re-checking in to edit.
const at = (iso) => ({ seconds: Math.floor(new Date(iso).getTime() / 1000) });
describe('oneVisitPerDay', () => {
  it('collapses same-place same-day real check-ins into the first, keeping photos', () => {
    const rows = [
      { id: 'b2', landmarkId: 'budare', visited: true, createdAt: at('2026-10-14T19:36:00'), photoURLs: ['p2'] },
      { id: 'x', landmarkId: 'other', visited: true, createdAt: at('2026-10-14T18:00:00') },
      { id: 'b1', landmarkId: 'budare', visited: true, createdAt: at('2026-10-14T19:01:00'), photoURLs: ['p1'] },
    ];
    const out = oneVisitPerDay(rows);
    expect(out.map((r) => r.id)).toEqual(['x', 'b1']);
    expect(out.find((r) => r.id === 'b1').photoURLs).toEqual(['p1', 'p2']);
  });

  it('keeps visits on different days and rating-only claims', () => {
    const rows = [
      { id: 'a1', landmarkId: 'a', visited: true, createdAt: at('2026-10-13T12:00:00') },
      { id: 'a2', landmarkId: 'a', visited: true, createdAt: at('2026-10-14T12:00:00') },
      { id: 'a3', landmarkId: 'a', ratingOnly: true, visited: false, createdAt: at('2026-10-14T13:00:00') },
    ];
    expect(oneVisitPerDay(rows).map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
  });
});
