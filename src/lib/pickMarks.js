import { PICK_MARK_LIMIT, PICK_MARK_WINDOW_MS, SURFACES } from './maprConstants';

// Remembers, per user and on this device, which places were last shown as a
// Mapr pick (setId, surface, shownAt). When the user later taps (pick_feedback)
// or rates (reviews) that place, the write carries pickSetId / pickSurface /
// pickShownAt so the match rate can tell a reaction to a pick from any other.
// Absent when the place was not shown as a pick, or the window has passed.

const KEY = (uid) => `lh-pick-marks:${uid}`;

function read(uid, storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY(uid)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function write(uid, map, storage) {
  try {
    storage.setItem(KEY(uid), JSON.stringify(map));
  } catch {
    /* private mode / storage unavailable: marking just does not happen */
  }
}

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

// Latest showing of a place wins. Bounded to PICK_MARK_LIMIT, newest kept.
export function rememberShownPicks({ uid, setId, surface, stops, at = Date.now(), storage = defaultStorage() }) {
  if (!uid || !setId || !storage || !stops?.length) return;
  const map = read(uid, storage);
  for (const s of stops) {
    if (!s?.id) continue;
    map[s.id] = { setId, surface: SURFACES.includes(surface) ? surface : null, shownAt: at };
  }
  const entries = Object.entries(map).sort((a, b) => (a[1].shownAt || 0) - (b[1].shownAt || 0));
  write(uid, Object.fromEntries(entries.slice(-PICK_MARK_LIMIT)), storage);
}

// The fields to spread onto a pick_feedback or review write: {} when the
// place did not come from a pick (so nothing is written and nothing existing
// is overwritten), else { pickSetId, pickSurface, pickShownAt }.
export function pickMarkFields(uid, landmarkId, { now = Date.now(), storage = defaultStorage(), windowMs = PICK_MARK_WINDOW_MS } = {}) {
  if (!uid || !landmarkId || !storage) return {};
  const m = read(uid, storage)[landmarkId];
  if (!m || typeof m.setId !== 'string' || !m.setId || m.setId.length > 200 || !Number.isFinite(m.shownAt)) return {};
  if (now < m.shownAt || now - m.shownAt > windowMs) return {};
  return { pickSetId: m.setId, pickSurface: SURFACES.includes(m.surface) ? m.surface : null, pickShownAt: m.shownAt };
}

export function clearPickMarks(uid, storage = defaultStorage()) {
  try {
    storage?.removeItem(KEY(uid));
  } catch {
    /* ignore */
  }
}
