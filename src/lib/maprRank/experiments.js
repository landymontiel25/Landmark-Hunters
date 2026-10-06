import { EXPERIMENT_SALTS, FEATURES } from './config.js';

// Stable user bucketing for feature rollouts and A/B tests. A uid is a
// string, so `user_id % 100` becomes a 32-bit FNV-1a hash of salt + uid, mod
// 100: the same user always lands in the same bucket for the same feature,
// and different features (different salts) split users independently.

export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// 0-99 for this user and feature.
export function bucketOf(uid, feature) {
  return fnv1a(`${EXPERIMENT_SALTS[feature] || feature}:${uid}`) % 100;
}

// 'treatment' when the feature is on and the user's bucket is inside its
// rollout, else 'control'. bucket < rollout keeps a 20% rollout the same
// users when it later grows to 50%.
export function variantFor(uid, feature, features = FEATURES) {
  const f = features[feature];
  if (!f || !f.enabled || !uid) return 'control';
  return bucketOf(uid, feature) < f.rollout ? 'treatment' : 'control';
}

export const isOn = (uid, feature, features = FEATURES) => variantFor(uid, feature, features) === 'treatment';

// Every feature's variant for one user, as saved on each telemetry row.
export function variantsFor(uid, features = FEATURES) {
  return Object.fromEntries(Object.keys(features).map((k) => [k, variantFor(uid, k, features)]));
}

// Small seeded PRNG (mulberry32), so a built set's exploration draws can be
// replayed in tests and do not depend on Math.random.
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
