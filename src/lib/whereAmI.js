import { distanceMeters } from './geo';

// The "Where I am" pill under the header (src/components/WhereAmI.jsx):
// the place you're standing at, or the street address, or "Traveling…"
// while you're on the move.

// Moving: over the last 30 s, a fix at least 10 s older than the newest
// is farther away than GPS drift could explain (30 m, or more with a rough
// fix) at walking pace or faster.
export const MOVE_WINDOW_MS = 30_000;
export const MOVE_MIN_SPAN_MS = 10_000;
export const MOVE_MIN_METERS = 30;
export const MOVE_MIN_SPEED = 0.9; // m/s, a slow walk
// After the last sign of movement, how long until you count as stopped.
export const STOP_AFTER_MS = 25_000;

export function isMoving(fixes, now = Date.now()) {
  const recent = fixes.filter((f) => now - f.t <= MOVE_WINDOW_MS);
  if (recent.length < 2) return false;
  const last = recent[recent.length - 1];
  return recent.some((f) => {
    const dt = (last.t - f.t) / 1000;
    if (dt * 1000 < MOVE_MIN_SPAN_MS) return false;
    const d = distanceMeters(f.lat, f.lng, last.lat, last.lng);
    const drift = Math.max(MOVE_MIN_METERS, 1.5 * (((f.accuracy || 0) + (last.accuracy || 0)) / 2));
    if (!(d > drift && d / dt >= MOVE_MIN_SPEED)) return false;
    // Real movement is steady: the fixes from the last third of that span
    // are still on the way, not already sitting at the end point. One
    // indoor GPS jump that then holds still fails this (owner, 2026-10-29:
    // "Traveling" while sitting in an office).
    const tail = recent.filter((g) => g !== last && g.t > f.t && last.t - g.t <= (dt * 1000) / 3);
    return tail.every((g) => distanceMeters(g.lat, g.lng, last.lat, last.lng) >= 0.2 * d);
  });
}

// The landmark you're at: the nearest one within 40 m (up to 80 m with a
// rough fix), so a café next door doesn't win over the one you're in.
export function placeAt(point, places, accuracy = 0) {
  if (!point) return null;
  const radius = Math.min(80, Math.max(40, accuracy || 0));
  let best = null;
  for (const p of places) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng) || !p.name) continue;
    const d = distanceMeters(point.lat, point.lng, p.lat, p.lng);
    if (d <= radius && (!best || d < best.d)) best = { place: p, d };
  }
  return best?.place || null;
}

// "Budare Bistro, 1801 SW 3rd Avenue, Miami, Florida" -> "Budare Bistro,
// 1801 SW 3rd Avenue": the first two parts are enough to know where you are.
export function shortAddress(label) {
  return String(label || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
}

// No address yet (still looking, or the lookups failed): the nearest place
// within 500 m, so the pill still says something useful.
export const NEAR_MAX_METERS = 500;
export function nearestPlace(point, places, maxMeters = NEAR_MAX_METERS) {
  if (!point) return null;
  let best = null;
  for (const p of places) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng) || !p.name) continue;
    const d = distanceMeters(point.lat, point.lng, p.lat, p.lng);
    if (d <= maxMeters && (!best || d < best.d)) best = { place: p, d };
  }
  return best?.place || null;
}

// The quick "Check in" button under the pill shows only this close to a
// place (owner, 2026-10-18). Checking in from a landmark's own page has no
// such limit.
export const QUICK_CHECKIN_METERS = 30;

// Every place within `meters`, the ones you haven't checked into first,
// then nearest first (owner, 2026-10-18).
export function placesWithin(point, places, meters, claimed = {}) {
  if (!point) return [];
  const out = [];
  const seen = new Set();
  for (const p of places) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng) || !p.name) continue;
    const d = distanceMeters(point.lat, point.lng, p.lat, p.lng);
    const key = p.id || `${p.name}|${p.lat}|${p.lng}`;
    if (d <= meters && !seen.has(key)) {
      seen.add(key);
      out.push({ place: p, d });
    }
  }
  out.sort((a, b) => !!claimed[a.place.id] - !!claimed[b.place.id] || a.d - b.d);
  return out.map((x) => x.place);
}
