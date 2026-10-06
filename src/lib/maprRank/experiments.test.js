import { describe, it, expect } from 'vitest';
import { bucketOf, fnv1a, isOn, seededRandom, variantFor, variantsFor } from './experiments.js';
import { FEATURES } from './config.js';

const uids = Array.from({ length: 10000 }, (_, i) => `user-${i}-${(i * 7919) % 1000}`);

describe('A/B assignment', () => {
  it('hashes deterministically (FNV-1a reference values)', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('puts the same user in the same bucket every time', () => {
    for (const u of uids.slice(0, 50)) {
      expect(bucketOf(u, 'ncf')).toBe(bucketOf(u, 'ncf'));
      expect(variantFor(u, 'ncf')).toBe(variantFor(u, 'ncf'));
    }
  });

  const at20 = { ...FEATURES, ncf: { enabled: true, rollout: 20 }, exploration: { enabled: true, rollout: 20 } };

  it('sends about 20% to treatment at a 20% rollout (user_id % 100 >= 80 rule, by hash)', () => {
    const share = uids.filter((u) => variantFor(u, 'ncf', at20) === 'treatment').length / uids.length;
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.22);
  });

  it('splits the two tests independently (different salts)', () => {
    const both = uids.filter((u) => isOn(u, 'ncf', at20) && isOn(u, 'exploration', at20)).length / uids.length;
    // 20% x 20% = 4% if independent.
    expect(both).toBeGreaterThan(0.03);
    expect(both).toBeLessThan(0.05);
  });

  it('keeps users in treatment when a rollout grows', () => {
    const at50 = { ...FEATURES, ncf: { enabled: true, rollout: 50 } };
    for (const u of uids.slice(0, 2000)) if (variantFor(u, 'ncf', at20) === 'treatment') expect(variantFor(u, 'ncf', at50)).toBe('treatment');
  });

  it('turns a feature off for everyone with its flag', () => {
    const off = { ...FEATURES, ncf: { enabled: false, rollout: 100 } };
    expect(uids.slice(0, 200).some((u) => variantFor(u, 'ncf', off) === 'treatment')).toBe(false);
  });

  it('gives control to a missing uid and to unknown features', () => {
    expect(variantFor(null, 'distanceDecay')).toBe('control');
    expect(variantFor('u1', 'nope')).toBe('control');
  });

  it('lists every feature variant for telemetry', () => {
    expect(Object.keys(variantsFor('u1'))).toEqual(Object.keys(FEATURES));
  });

  it('puts everyone in a 100% rollout', () => {
    expect(uids.slice(0, 500).every((u) => variantFor(u, 'distanceDecay') === 'treatment')).toBe(true);
  });

  it('ships the Phase 1 components on for everyone and Mapr v2 to a 20% rollout', () => {
    const { maprV2, ...phase1 } = FEATURES;
    for (const f of Object.values(phase1)) expect(f).toEqual({ enabled: true, rollout: 100 });
    expect(maprV2).toEqual({ enabled: true, rollout: 20 });
  });
});

describe('seededRandom', () => {
  it('replays the same stream for the same seed and stays in [0, 1)', () => {
    const a = seededRandom('set-1');
    const b = seededRandom('set-1');
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(seededRandom('set-2')()).not.toBe(seededRandom('set-1')());
  });
});
