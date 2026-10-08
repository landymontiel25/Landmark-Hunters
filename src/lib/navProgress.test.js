import { describe, it, expect } from 'vitest';
import { prepareRoute, navProgress, maneuverIcon } from './navProgress';

// An L-shaped route: ~1.1 km north, then ~850 m east.
const corner = [40.01, -75.0];
const data = {
  mode: 'DRIVE',
  durationSeconds: 400,
  points: [
    [40.0, -75.0],
    [40.005, -75.0],
    corner,
    [40.01, -74.995],
    [40.01, -74.99],
  ],
  steps: [
    { instruction: 'Head north on Main St', distanceMeters: 1112, end: corner, maneuver: 'DEPART' },
    { instruction: 'Turn right onto Oak Ave', distanceMeters: 852, end: [40.01, -74.99], maneuver: 'TURN_RIGHT' },
  ],
};
const route = prepareRoute(data);

describe('navProgress', () => {
  it('on the first leg, the next maneuver is the turn at the corner', () => {
    const p = navProgress(route, { lat: 40.003, lng: -75.0, accuracy: 10 });
    expect(p.stepIndex).toBe(0);
    expect(p.next.instruction).toBe('Turn right onto Oak Ave');
    expect(p.metersToNext).toBeGreaterThan(700);
    expect(p.metersToNext).toBeLessThan(850);
    expect(p.offRoute).toBe(false);
    expect(p.arrived).toBe(false);
  });

  it('after the turn, the last step leads to arrival and time remaining shrinks', () => {
    const early = navProgress(route, { lat: 40.003, lng: -75.0 });
    const p = navProgress(route, { lat: 40.01, lng: -74.994 });
    expect(p.stepIndex).toBe(1);
    expect(p.next).toBeNull();
    expect(p.metersToNext).toBeCloseTo(p.remainingMeters, 0);
    expect(p.remainingSeconds).toBeLessThan(early.remainingSeconds);
  });

  it('flags being off the route', () => {
    const p = navProgress(route, { lat: 40.005, lng: -75.003, accuracy: 10 });
    expect(p.offset).toBeGreaterThan(200);
    expect(p.offRoute).toBe(true);
  });

  it('a poor GPS fix widens the off-route tolerance', () => {
    const p = navProgress(route, { lat: 40.005, lng: -75.0009, accuracy: 100 });
    expect(p.offRoute).toBe(false);
  });

  it('detects arrival near the destination', () => {
    expect(navProgress(route, { lat: 40.0101, lng: -74.99 }).arrived).toBe(true);
  });

  it('works without step end points, from step lengths', () => {
    const r = prepareRoute({ ...data, steps: data.steps.map((s) => ({ ...s, end: undefined })) });
    expect(navProgress(r, { lat: 40.003, lng: -75.0 }).next.instruction).toBe('Turn right onto Oak Ave');
  });

  it('a step with no instruction does not show "Arrive" partway along the route', () => {
    // Main St split in two by the API, the second half with no instruction.
    const mid = [40.005, -75.0];
    const r = prepareRoute({
      ...data,
      steps: [
        { instruction: 'Head north on Main St', distanceMeters: 556, end: mid, maneuver: 'DEPART' },
        { instruction: '', distanceMeters: 556, end: corner, maneuver: '' },
        data.steps[1],
      ],
    });
    const p = navProgress(r, { lat: 40.003, lng: -75.0, accuracy: 10 });
    expect(p.next.instruction).toBe('Turn right onto Oak Ave');
    expect(p.metersToNext).toBeGreaterThan(700);
  });

  it('picks an arrow for each maneuver', () => {
    expect(maneuverIcon('TURN_LEFT')).toBe('\u{2B05}\u{FE0F}');
    expect(maneuverIcon('TURN_RIGHT')).toBe('\u{27A1}\u{FE0F}');
    expect(maneuverIcon('UTURN_LEFT')).toBe('\u{21A9}\u{FE0F}');
    expect(maneuverIcon('')).toBe('\u{2B06}\u{FE0F}');
  });
});
