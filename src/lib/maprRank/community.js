import { isNeighbor } from './neighbors.js';

// Community picks (docs/discovery-network-plan.md, steps 5 to 7). Pure, so
// the server (api/_lib/communityServer.js, which computes each viewer's
// weights) and the nightly density job agree, and so every Mapr surface
// applies the same lift in scorePicks (rank.js). Nobody sees these numbers:
// a pick shows only "Found by people like you" and who found it.

export const FINDER_CAP = 2.0;
export const FOLLOW_WEIGHT = 1.4;
export const FRIEND_WEIGHT = 1.3;
export const NEIGHBOR_SLOPE = 0.6;
export const REPUTATION_SLOPE = 0.5;
export const EXTRA_FINDER = 0.1;
export const EXTRA_FINDER_MAX = 0.3;

// Step 5, one finder: the strongest of what they are to you. A taste
// neighbor (0.3 or more) counts 1 + 0.6 x score, someone you follow 1.4, a
// friend 1.3, anyone with local reputation (Phase 4, 0 to 1) 1 + 0.5 x it.
// Nothing: 1.
export function finderWeight({ neighborScore = null, follows = false, friend = false, reputation = 0 } = {}) {
  let w = 1;
  if (isNeighbor(neighborScore)) w = Math.max(w, 1 + NEIGHBOR_SLOPE * neighborScore);
  if (follows) w = Math.max(w, FOLLOW_WEIGHT);
  if (friend) w = Math.max(w, FRIEND_WEIGHT);
  if (Number.isFinite(reputation) && reputation > 0) w = Math.max(w, 1 + REPUTATION_SLOPE * Math.min(1, reputation));
  return w;
}

// Step 5, one place: the best single finder among its live, verified tips,
// plus 0.1 for each extra distinct finder (up to 0.3), capped at 2.0. A
// place with no such tip keeps 1. `weights` is one entry per distinct
// finder.
export function placeFinderWeight(weights) {
  const ws = (weights || []).filter(Number.isFinite);
  if (!ws.length) return 1;
  const extra = Math.min(EXTRA_FINDER_MAX, EXTRA_FINDER * (ws.length - 1));
  return Math.min(FINDER_CAP, Math.max(...ws) + extra);
}

// Step 6: a verified visit in the last 30 days counts 1.0, falling to 0.7 at
// 180 days and 0.5 at a year, never below 0.5.
export function freshness(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays <= 30) return 1;
  if (ageDays <= 180) return 1 - (0.3 * (ageDays - 30)) / 150;
  if (ageDays <= 365) return 0.7 - (0.2 * (ageDays - 180)) / 185;
  return 0.5;
}

// Step 7: how far a city has shifted from Mapr only toward people.
export const RAMP_USERS = 100;
export const RAMP_TIPS = 150;
export function ramp({ activeUsers = 0, liveTips = 0 } = {}) {
  return Math.max(0, Math.min(1, activeUsers / RAMP_USERS, liveTips / RAMP_TIPS));
}

// Step 7: communityWeight = 1 + (finderWeight - 1) x ramp. Freshness scales
// the lift only (the plan multiplied the whole score by it, which would
// rank a place with an old tip below the same place with no tip at all).
export function communityWeight(placeWeight, rampValue, fresh = 1) {
  const w = Number.isFinite(placeWeight) ? Math.min(FINDER_CAP, placeWeight) : 1;
  const r = Number.isFinite(rampValue) ? Math.max(0, Math.min(1, rampValue)) : 0;
  const f = Number.isFinite(fresh) ? Math.max(0, Math.min(1, fresh)) : 1;
  return 1 + (w - 1) * r * f;
}

// The lift on a ranked score: multiplied in, or divided for a negative one
// (a disliked place must not get worse for having a tip).
export function applyCommunity(score, weight) {
  if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 1) return score;
  return score >= 0 ? score * weight : score / weight;
}

// The density gate (Phase 6's feed opens in a city only past it), checked
// each night; it holds after 14 days in a row.
export const GATE = { discoverers30: 30, liveTipPlaces: 150, medianNearby: 5, days: 14 };
export function gateMet({ discoverers30 = 0, liveTipPlaces = 0, medianNearby = 0 } = {}) {
  return discoverers30 >= GATE.discoverers30 && liveTipPlaces >= GATE.liveTipPlaces && medianNearby >= GATE.medianNearby;
}
// The run of days the gate has held, given yesterday's doc.
export function gateStreak(prev, met, date) {
  if (prev?.date === date) return prev.gateStreakDays || 0;
  return met ? (prev?.gateStreakDays || 0) + 1 : 0;
}
export const gateOpen = (streakDays) => streakDays >= GATE.days;

// Days since the middle of a tip's visit month ("2026-10"): a tip keeps
// only the month, never the day.
export function visitAgeDays(visitMonth, nowMs = Date.now()) {
  const m = /^(\d{4})-(\d{2})$/.exec(visitMonth || '');
  if (!m) return null;
  const mid = Date.UTC(Number(m[1]), Number(m[2]) - 1, 15);
  return Math.max(0, (nowMs - mid) / 86400000);
}
