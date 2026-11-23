import { localDayKey, isDayBefore } from './streakDay.js';

// The streaks' clock is the server's (anti-farming item 2, owner 2026-11-23).
// Before, the phone said what day it was (dayId), how its day was cut
// (tzOffsetMin) and when each pick answer happened (pick_feedback.at), so a
// streak could be grown by moving the day or backdating answers. Now:
//   - each streak keeps a pinned IANA time zone (`tz` on the streak doc,
//     server-written). A phone may move it (travel) at most once every
//     ZONE_CHANGE_MIN_MS; until then the pinned one stands.
//   - "today" is the server's clock in that zone (serverDay).
//   - a pick answer's time is when Firestore wrote it (the snapshot's
//     updateTime), never the `at` the phone put in it.

export const ZONE_CHANGE_MIN_MS = 20 * 60 * 60 * 1000;

export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

// { zone, update }: the zone to use now, and what to store (null: nothing).
export function pinZone(stored, clientZone, nowMs = Date.now()) {
  const asked = validZone(clientZone);
  const have = validZone(stored?.zone);
  if (!have) return asked ? { zone: asked, update: { zone: asked, setAtMs: nowMs } } : { zone: null, update: null };
  if (!asked || asked === have) return { zone: have, update: null };
  if (nowMs - (Number(stored.setAtMs) || 0) >= ZONE_CHANGE_MIN_MS) return { zone: asked, update: { zone: asked, setAtMs: nowMs } };
  return { zone: have, update: null };
}

export const serverDay = (zone, nowMs = Date.now()) => localDayKey(nowMs, zone);

const tsMs = (t) =>
  typeof t?.toMillis === 'function' ? t.toMillis() : Number.isFinite(t?.seconds) ? t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6) : null;

// When Firestore last wrote this document (Admin SDK snapshot), or the
// plain-object stand-in tests pass ({ updateTimeMs }).
export function writtenAtMs(snap) {
  if (!snap) return null;
  if (Number.isFinite(snap.updateTimeMs)) return snap.updateTimeMs;
  return tsMs(snap.updateTime) ?? tsMs(snap.createTime);
}

const dataOf = (raw) => (typeof raw?.data === 'function' ? raw.data() : raw);
const VERDICTS = new Set(['yes', 'no', 'unsure']);

// Distinct landmarks engaged with on `dayId` in `zone`, by server time:
// pick answers (Firestore's write time) and check-ins (createdAt is
// server-set by the rules).
export function distinctActionsOnDay(pickSnaps, checkinSnaps, zone, dayId) {
  if (!zone || !dayId) return 0;
  const ids = new Set();
  for (const raw of pickSnaps || []) {
    const f = dataOf(raw);
    if (!f || !VERDICTS.has(f.verdict)) continue;
    const id = typeof f.landmarkId === 'string' ? f.landmarkId : '';
    const at = writtenAtMs(raw);
    if (id && id.length <= 100 && Number.isFinite(at) && localDayKey(at, zone) === dayId) ids.add(id);
  }
  for (const raw of checkinSnaps || []) {
    const c = dataOf(raw);
    const id = typeof c?.landmarkId === 'string' ? c.landmarkId : '';
    const at = tsMs(c?.createdAt);
    if (id && id.length <= 100 && Number.isFinite(at) && localDayKey(at, zone) === dayId) ids.add(id);
  }
  return ids.size;
}

// A real visit the server verified (presence.verified) on that day.
export function hasVerifiedCheckinOnDay(checkinSnaps, zone, dayId) {
  if (!zone || !dayId) return false;
  for (const raw of checkinSnaps || []) {
    const c = dataOf(raw);
    if (!c || c.ratingOnly || c.visited === false || c.presence?.verified !== true) continue;
    const at = tsMs(c.createdAt);
    if (Number.isFinite(at) && localDayKey(at, zone) === dayId) return true;
  }
  return false;
}

// Landmarks answered before `dayId` (by server time), for the solo deck's
// "fresh cards first" (sharedDeck.js avoidIds): id -> when.
export function answeredBeforeDay(pickSnaps, checkinSnaps, zone, dayId) {
  const out = new Map();
  const add = (id, at) => {
    if (typeof id !== 'string' || !id || !Number.isFinite(at) || !isDayBefore(localDayKey(at, zone), dayId)) return;
    out.set(id, Math.max(out.get(id) || 0, at));
  };
  for (const raw of pickSnaps || []) add(dataOf(raw)?.landmarkId, writtenAtMs(raw));
  for (const raw of checkinSnaps || []) add(dataOf(raw)?.landmarkId, tsMs(dataOf(raw)?.createdAt));
  return out;
}

// The day's cards, drawn once by the server and stored on
// streaks/{id}/days/{dayId} (members read it; nobody writes it but here).
// Resolves to { cards, cityId }: a city changed later that day doesn't
// change that day's cards.
export async function assignDeck(streakRef, dayId, draw, cityId = null) {
  const ref = streakRef.collection('days').doc(dayId);
  const snap = await ref.get();
  const have = snap.exists ? snap.data() : null;
  if (Array.isArray(have?.cards) && have.cards.length) return { cards: have.cards, cityId: have.cityId ?? cityId };
  const cards = draw();
  if (!cards.length) return { cards, cityId };
  await ref.set({ cards, cityId, assignedAtMs: Date.now() }, { merge: true });
  return { cards, cityId };
}
