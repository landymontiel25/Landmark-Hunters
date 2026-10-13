import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
const { densityNumbers, runCommunityDensity, readDensity } = await import('./communityDensity.js');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const LM = { 'philly/a': { lat: 39.95, lng: -75.16 }, 'philly/b': { lat: 39.951, lng: -75.161 }, 'villanova/c': { lat: 40.037, lng: -75.342 }, 'philly/far': { lat: 40.5, lng: -75.16 } };
const findLandmark = (r, id) => LM[`${r}/${id}`] || null;

const ds = {
  truncated: [],
  tips: [
    { authorUid: 'f1', region: 'philly', landmarkId: 'a', status: 'live', hidden: false, createdAt: NOW - 86400000 },
    { authorUid: 'f2', region: 'philly', landmarkId: 'b', status: 'live', hidden: false, createdAt: NOW - 40 * 86400000 },
    { authorUid: 'f3', region: 'villanova', landmarkId: 'c', status: 'live', hidden: false, createdAt: NOW },
    { authorUid: 'f4', region: 'philly', landmarkId: 'a', status: 'held', hidden: false, createdAt: NOW },
    { authorUid: 'f5', region: 'miami', landmarkId: 'x', status: 'live', hidden: false, createdAt: NOW },
  ],
  checkins: [
    { userId: 'u1', region: 'philly', landmarkId: 'a', createdAt: NOW - 1000 },
    { userId: 'u2', region: 'philly', landmarkId: 'far', createdAt: NOW - 1000 },
    { userId: 'u3', region: 'miami', landmarkId: 'x', createdAt: NOW - 1000 },
  ],
  reviews: [],
};

describe('densityNumbers', () => {
  it('counts the launch area as one: live tips, places, active people, recent discoverers, nearby median, ramp', () => {
    const n = densityNumbers(ds, { nowMs: NOW, findLandmark });
    expect(n).toMatchObject({ activeUsers: 2, liveTips: 3, liveTipPlaces: 3, discoverers30: 2, medianNearby: 1 });
    expect(n.ramp).toBeCloseTo(Math.min(2 / 100, 3 / 150), 4);
    expect(n.gateMet).toBe(false);
  });
});

describe('runCommunityDensity / readDensity', () => {
  it('writes both launch regions, counts gate days once per date, and reads ramp 0 elsewhere', async () => {
    const db = fakeDb({ 'community_density/philly': { date: '2026-10-11', gateStreakDays: 3 } });
    await runCommunityDensity(db, ds, { nowMs: NOW, date: '2026-10-12' });
    expect(db.docs['community_density/philly'].gateStreakDays).toBe(0);
    expect(db.docs['community_density/villanova'].ramp).toBe(db.docs['community_density/philly'].ramp);
    const r = await readDensity(db, ['philly', 'miami']);
    expect(Object.keys(r)).toEqual(['philly']);
    expect(r.philly.gateOpen).toBe(false);
  });
});
