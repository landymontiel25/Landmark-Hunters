import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { dayKey } from './streaks';
import { pickDailyCardIds } from './sharedDeck';
import { authHeaders } from './apiAuth';
import { syncLocalFeedbackToFirestore } from './pickFeedback';
import { API_BASE } from './apiBase';

// Solo streaks -- back after being retired at #405, now sharing the same
// streaks/{id} collection as dual streaks (mode: 'solo', memberIds: [uid],
// doc id is just the uid, no pairing). Rate 3 landmarks a day (the SAME
// deterministic per-day-3 mechanism dual streaks use, sharedDeck.js, just
// seeded with your own uid instead of a pairId -- so it's "your own
// personal 3", not shared with anyone) and the count goes up. No guess
// step, no partner, 1 personal freeze a month (half the dual streak's 2
// shared ones), no shared freezes, no recovery mission, no reveal.
//
// count/best/lastCompletedDay/freezesLeft/freezeMonth/frozenDays are
// server-authority (api/ensure-solo-streak.js, api/close-solo-streak-day.js,
// api/use-solo-streak-freeze.js, admin SDK) -- cityId is the one field the
// client can set itself, same pattern as pairStreaks.js. The doc is
// created (and, for anyone with a pre-existing streak, seeded from their
// real check-in/pick_feedback history rather than reset to 0) the first
// time ensureSoloStreak is called -- see that endpoint's own note.
export async function ensureSoloStreak(userName, uid) {
  // timeZone (IANA, e.g. "America/New_York") lets the server bucket
  // historical check-ins/votes into the SAME calendar days the browser
  // itself would -- without it, a server that isn't in the user's own
  // timezone (every Vercel function; always UTC) can shift day boundaries
  // and badly under-count a real streak. See api/ensure-solo-streak.js's
  // own note.
  let timeZone;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* unsupported/unavailable -- the endpoint falls back gracefully */
  }
  // Give any vote that only ever made it to this device's localStorage (a
  // past best-effort Firestore write that silently failed) one more chance
  // to sync BEFORE the server reads pick_feedback below -- otherwise a
  // whole streak day resting on a local-only vote is invisible to it and
  // the seed/repair under-counts even with the timezone fixed. Best-effort
  // itself: never blocks or fails ensureSoloStreak over a sync hiccup.
  if (uid) await syncLocalFeedbackToFirestore(uid).catch(() => {});
  const r = await fetch(`${API_BASE}/api/ensure-solo-streak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ userName, timeZone }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { userMessage: data?.error });
  return data;
}

export function subscribeMySoloStreak(uid, onStreak, onError) {
  if (!db || !uid) return () => {};
  return onSnapshot(
    doc(db, 'streaks', uid),
    (snap) => onStreak(snap.exists() ? { id: uid, ...snap.data() } : null),
    onError
  );
}

export async function setSoloStreakCity(uid, cityId) {
  if (!db) return;
  await updateDoc(doc(db, 'streaks', uid), { cityId, updatedAt: serverTimestamp() });
}

// Today's 3 personal cards -- pickDailyCardIds seeded with the user's own
// uid in place of a pairId, so it's deterministic and repeatable the same
// way a pair's shared deck is, just for an audience of one.
export function todaysSoloCardIds(uid, cityId) {
  if (!cityId) return [];
  return pickDailyCardIds(uid, dayKey(new Date()), cityId);
}

export async function submitSoloCardRating(uid, landmarkId, verdict) {
  if (!db) return;
  const today = dayKey(new Date());
  await setDoc(
    doc(db, 'streaks', uid, 'days', today, 'entries', uid),
    { uid, ratings: { [landmarkId]: verdict }, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export function subscribeSoloDayEntry(uid, dayId, onEntry, onError) {
  if (!db || !uid || !dayId) return () => {};
  return onSnapshot(
    doc(db, 'streaks', uid, 'days', dayId, 'entries', uid),
    (snap) => onEntry(snap.exists() ? snap.data() : { uid, ratings: {} }),
    onError
  );
}

// Pings the server to check whether today closes -- call after rating
// lands. Safe to call any time; api/close-solo-streak-day.js re-derives
// today's real 3 cards and re-checks them itself rather than trusting the
// caller. Points (for a secured day, and any milestone bonus) are awarded
// server-side in that same call, not reported back for the client to
// award a second time.
export async function closeSoloToday() {
  const today = dayKey(new Date());
  const r = await fetch(`${API_BASE}/api/close-solo-streak-day`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ dayId: today }),
  });
  const data = await r.json().catch(() => null);
  return data || { ok: false };
}

// Spends the month's one personal freeze to hold today -- server-
// authoritative (api/use-solo-streak-freeze.js), same pattern as
// pairStreaks.js's spendFreeze.
export async function spendSoloFreeze() {
  const r = await fetch(`${API_BASE}/api/use-solo-streak-freeze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { userMessage: data?.error });
  return data;
}

export const SOLO_FREEZES_PER_MONTH = 1;
