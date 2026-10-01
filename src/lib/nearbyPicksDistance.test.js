// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  DISTANCE_OPTIONS_MI,
  METERS_PER_MILE,
  chipCovering,
  eligiblePlaces,
  fallbackReason,
  isClosedNow,
  nearestBeyond,
  rankNearbyCandidates,
  rankScore,
  readStoredDistance,
  smartDistance,
  withinDistance,
  writeStoredDistance,
} from './nearbyPicks';
import { ALL_LANDMARKS } from '../data/regions';

const DORAL = { lat: 25.8195, lng: -80.3553 };
const MIDTOWN = { lat: 40.7549, lng: -73.984 };
const SUBURB = { lat: 40.0073, lng: -75.2305 }; // Bala Cynwyd, PA
const miles = (m) => m / METERS_PER_MILE;
const NOW = new Date('2026-10-01T03:00:00');

describe('real catalog density', () => {
  it('Doral has nothing in the catalog within 5 mi, but plenty within 10', () => {
    expect(withinDistance(ALL_LANDMARKS, DORAL, 5)).toHaveLength(0);
    expect(withinDistance(ALL_LANDMARKS, DORAL, 10).length).toBeGreaterThanOrEqual(20);
    expect(miles(withinDistance(ALL_LANDMARKS, DORAL, 100)[0].distanceMeters)).toBeGreaterThan(5);
  });

  it('3 AM does not hide the nearby catalog (no built-in place carries hours)', () => {
    const all = withinDistance(ALL_LANDMARKS, DORAL, 10);
    expect(eligiblePlaces({ origin: DORAL, miles: 10, date: NOW })).toHaveLength(all.length);
    expect(isClosedNow({ hours: 'Mon-Sun 7am-9pm' }, NOW)).toBe(true); // a user-added place that says so is closed
    expect(isClosedNow({ hours: 'Open 24 hours' }, NOW)).toBe(false);
  });
});

describe('smart default distance', () => {
  it('opens tight where it is dense and wide where it is thin', () => {
    expect(smartDistance({ origin: MIDTOWN, units: 'imperial', date: NOW })).toBe(1);
    expect(smartDistance({ origin: SUBURB, units: 'imperial', date: NOW })).toBe(5);
    expect(smartDistance({ origin: DORAL, units: 'imperial', date: NOW })).toBe(10);
  });
  it('hand-added places nearby count', () => {
    const custom = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, region: 'miami', lat: DORAL.lat + 0.002 * i, lng: DORAL.lng, images: ['https://x/y.jpg'], categories: ['food'] }));
    expect(smartDistance({ origin: DORAL, units: 'imperial', date: NOW, extraPlaces: custom })).toBe(1);
  });
  it('remembers an explicit choice per user and survives broken storage', () => {
    localStorage.clear();
    writeStoredDistance('u1', 5);
    expect(readStoredDistance('u1')).toBe(5);
    expect(readStoredDistance('u2')).toBeNull();
    localStorage.setItem('lh-picks-distance:v1:u3', '7');
    expect(readStoredDistance('u3')).toBeNull();
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readStoredDistance('u1')).toBeNull();
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});

describe('nearest beyond the radius', () => {
  it('lists the nearest three past 1 mi at Doral, closest first', () => {
    const list = nearestBeyond({ origin: DORAL, miles: 1, date: NOW });
    expect(list).toHaveLength(3);
    expect(list[0].name).toBe('El Palacio de los Jugos');
    expect(miles(list[0].distanceMeters)).toBeCloseTo(5.7, 0);
    expect(list.every((p, i) => i === 0 || p.distanceMeters >= list[i - 1].distanceMeters)).toBe(true);
  });
  it('widen target is the smallest chip that reaches the nearest place', () => {
    const near = nearestBeyond({ origin: DORAL, miles: 1, date: NOW })[0];
    expect(chipCovering(near.distanceMeters, 'imperial', DISTANCE_OPTIONS_MI, 1)).toBe(10);
    expect(chipCovering(1000, 'imperial', DISTANCE_OPTIONS_MI, 1)).toBe(5);
    expect(chipCovering(near.distanceMeters, 'metric', DISTANCE_OPTIONS_MI, 1)).toBe(10); // 10 km = 6.2 mi
  });
  it('only returns places past the radius', () => {
    expect(nearestBeyond({ origin: DORAL, miles: 100, date: NOW }).every((p) => p.distanceMeters > 100 * METERS_PER_MILE)).toBe(true);
  });
});

describe('ranking: distance is a real factor', () => {
  it('a 0.3 mi pick beats an equal 8 mi pick, but a far much-better fit still wins', () => {
    const near = { tagScore: 10, distanceMeters: 0.3 * METERS_PER_MILE };
    const far = { tagScore: 10, distanceMeters: 8 * METERS_PER_MILE };
    expect(rankScore(near)).toBeGreaterThan(rankScore(far));
    expect(rankScore({ tagScore: 40, distanceMeters: 8 * METERS_PER_MILE })).toBeGreaterThan(rankScore(near));
  });

  it('with real catalog data and no taste signal, Doral picks come out nearest first', () => {
    const { fresh } = rankNearbyCandidates({ profile: {}, origin: DORAL, miles: 10, date: NOW, now: NOW.getTime() });
    expect(fresh.length).toBeGreaterThan(5);
    const d = fresh.map((p) => p.distanceMeters);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  it('a place the user added by hand shows up as a pick and outranks catalog places 7+ mi away', () => {
    const custom = { id: 'custom-1', name: "Abuela's Cafe", region: 'miami', lat: 25.8225, lng: -80.356, categories: ['food'], images: ['https://x/y.jpg'], summary: '' };
    const { fresh, usual } = rankNearbyCandidates({ profile: {}, origin: DORAL, miles: 10, date: NOW, now: NOW.getTime(), extraPlaces: [custom] });
    const all = [...usual, ...fresh];
    expect(all[0].id).toBe('custom-1');
    expect(all[0].region).toBe('miami');
    expect(miles(all[0].distanceMeters)).toBeLessThan(0.5);
    const tight = rankNearbyCandidates({ profile: {}, origin: { lat: 25.9, lng: -80.3 }, miles: 1, date: NOW, now: NOW.getTime(), extraPlaces: [custom] });
    expect([...tight.usual, ...tight.fresh].some((p) => p.id === 'custom-1')).toBe(false);
  });

  it('custom places closed at 3 AM, or rated low by the user, are skipped', () => {
    const closed = { id: 'custom-2', name: 'Day Cafe', region: 'miami', lat: 25.8225, lng: -80.356, categories: ['food'], hours: 'Mon-Sun 9am-5pm' };
    const args = { profile: {}, origin: DORAL, miles: 10, date: NOW, now: NOW.getTime(), extraPlaces: [closed] };
    expect(rankNearbyCandidates(args).fresh.some((p) => p.id === 'custom-2')).toBe(false);
    const open = { ...closed, hours: 'Open 24 hours' };
    expect(rankNearbyCandidates({ ...args, extraPlaces: [open] }).fresh.some((p) => p.id === 'custom-2')).toBe(true);
    const low = { 'custom-2': { landmarkId: 'custom-2', ratingTier: 'probably-skip', stars: 1 } };
    expect(rankNearbyCandidates({ ...args, extraPlaces: [open], myReviews: low }).fresh.some((p) => p.id === 'custom-2')).toBe(false);
  });
});

describe('reason lines carry the real distance in the right unit', () => {
  const p = { categories: ['food'], pickType: 'usual', distanceMeters: 0.3 * METERS_PER_MILE };
  it('imperial and metric', () => {
    expect(fallbackReason(p, 'imperial')).toMatch(/0\.3 mi away\.$/);
    expect(fallbackReason({ ...p, distanceMeters: 7.2 * METERS_PER_MILE }, 'imperial')).toMatch(/7\.2 mi away\.$/);
    expect(fallbackReason({ ...p, distanceMeters: 7200 }, 'metric')).toMatch(/7\.2 km away\.$/);
  });
  it('no units, no clause', () => {
    expect(fallbackReason({ categories: ['food'] })).not.toMatch(/away/);
  });
});

describe('widenChip', () => {
  const far = [{ distanceMeters: 7 * 1609.34 }];
  it('picks the smallest wider chip reaching the nearest place', async () => {
    const { widenChip } = await import('./nearbyPicks');
    expect(widenChip(far, 1, 'imperial')).toBe(10);
  });
  it('offers nothing with no place beyond, or at the biggest chip', async () => {
    const { widenChip } = await import('./nearbyPicks');
    expect(widenChip([], 1, 'imperial')).toBeNull();
    expect(widenChip(far, 100, 'imperial')).toBeNull();
  });
});
