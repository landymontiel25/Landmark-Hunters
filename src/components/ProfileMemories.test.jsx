// @vitest-environment jsdom
// Owner, 2026-10-20: memories' photos at the top of Profile, one row first,
// then "Show more" opens the rest in a box that scrolls on its own.
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { auth, rows, checkIn, photos } = vi.hoisted(() => {
  const ts = (d) => ({ seconds: Math.floor(new Date(d).getTime() / 1000) });
  return {
    // Stable objects, like the real contexts (a new one each render re-runs effects).
    auth: { user: { uid: 'me' }, firebaseEnabled: true },
    checkIn: { claimedMap: {} },
    photos: { myPhotos: { b: ['b.jpg'] } },
    rows: [
      { id: 'a', landmarkId: 'a', landmarkName: 'Alpha', region: 'miami', visited: true, createdAt: ts('2026-10-01'), photoURLs: ['a.jpg'] },
      { id: 'b', landmarkId: 'b', landmarkName: 'Bravo', region: 'miami', visited: true, createdAt: ts('2026-10-05') },
      { id: 'c', landmarkId: 'c', landmarkName: 'Charlie', region: 'miami', visited: true, createdAt: ts('2026-10-03') },
      { id: 'd', landmarkId: 'd', landmarkName: 'Delta', region: 'miami', visited: true, createdAt: ts('2026-10-04') },
      { id: 'e', landmarkId: 'e', landmarkName: 'Rated only', region: 'miami', ratingOnly: true, visited: false, createdAt: ts('2026-10-06') },
    ],
  };
});
vi.mock('../lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => checkIn }));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => photos }));
vi.mock('../lib/leaderboard', () => ({
  getUserCheckins: async () => rows,
  isRealCheckin: (x) => !x.ratingOnly && x.visited !== false,
}));

const { default: ProfileMemories } = await import('./ProfileMemories');

describe('Profile memories grid', () => {
  it('shows one row newest first, then Show more opens a scrolling box with the rest', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<MemoryRouter><ProfileMemories /></MemoryRouter>));
    await act(async () => {});
    const names = () => [...el.querySelectorAll('.checkin-tile-name')].map((n) => n.textContent);
    expect(el.textContent).toContain('My Memories (4)');
    expect(names()).toEqual(['Bravo', 'Delta', 'Charlie']);
    expect(el.querySelector('.checkin-tile img').getAttribute('src')).toBe('b.jpg');
    const more = el.querySelector('.badges-more');
    expect(more.textContent).toBe('Show more (1)');
    await act(async () => more.click());
    expect(names()).toEqual(['Bravo', 'Delta', 'Charlie', 'Alpha']);
    // The box scrolls on a wrapper; the grid inside is never height-capped
    // (iPhone Safari squeezes a capped grid's rows into slivers).
    expect(el.querySelector('.profile-memories-scroll > .checkin-grid')).toBeTruthy();
    expect(el.querySelector('.checkin-grid').classList.contains('profile-memories-scroll')).toBe(false);
    el.remove();
  });
});
