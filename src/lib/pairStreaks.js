import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { dayKey, monthKey, PICKS_STREAK_THRESHOLD } from './streaks';
import { getUserReviews } from './reviews';
import { authHeaders } from './apiAuth';
import { pickDailyCardIds } from './sharedDeck';
import { API_BASE } from './apiBase';

export const FREEZES_PER_MONTH = 2;

// Dual streaks (Dual Streak spec, phase 3): a streak belongs to a pair of
// friends, not a person. Each day, both members see the SAME 3 landmarks
// (sharedDeck.js -- deterministic, not an actual scheduled server function,
// see that file's own note) and, per card, rate it then guess what their
// partner will say (spec item 2 -- the guess only unlocks after you've
// rated). The day counts once both members have rated and guessed all 3.
// Not built yet: squads, and the full "Reveal" screen with match
// highlights/bonus points (MyStreaks.jsx shows a lighter inline version:
// each card reveals both people's rating/guess once both are in).
//
// Data model:
//   streaks/{pairId}: memberIds, memberNames, cityId, count, best,
//     lastCompletedDay, freezesLeft, freezeMonth, frozenDays,
//     recoveryUsedMonth, createdAt. cityId is the one field either member
//     can set themselves (setStreakCity); count/best/lastCompletedDay/
//     freezesLeft/freezeMonth/frozenDays/recoveryUsedMonth are
//     server-authority only -- firestore.rules blocks any other client
//     write to an existing doc, so the only way those change is
//     api/close-streak-day.js, api/use-streak-freeze.js, and
//     api/complete-recovery-mission.js (admin SDK, bypasses rules).
//   streaks/{pairId}/days/{dayId}/entries/{uid}: uid, ratings (map of
//     landmarkId -> verdict), guesses (same shape), done, updatedAt --
//     each member writes only their own entry (rules-enforced).

export function pairIdOf(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

export const MAX_ACTIVE_STREAKS = 3;

// A solo streak doc ALSO has memberIds: [uid] (see soloStreaks.js), so an
// array-contains match on the shared streaks/ collection returns the
// caller's own solo streak too, mixed in as if it were a dual one -- a
// phantom row with no real partner. That's a real bug that shipped: it let
// "leave streak" on that phantom row delete the solo doc entirely (deleteDoc
// by id, and a solo doc's own id is just the uid), instead of leaving an
// actual pair.
//
// Filtered out client-side (mode !== 'solo'), not with a Firestore
// where('mode', '==', 'dual') query: every solo doc always has mode:
// 'solo' set (ensure-solo-streak.js), so excluding that is enough -- and
// doing it this way needs no new composite index, and can't silently hide
// a dual streak created before the mode field existed (mode undefined on
// an old doc still isn't 'solo', so it stays in the list).
const isNotSolo = (d) => d.mode !== 'solo';

export function subscribeMyStreaks(uid, onStreaks, onError) {
  if (!db || !uid) return () => {};
  const q = query(collection(db, 'streaks'), where('memberIds', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => onStreaks(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isNotSolo)),
    onError
  );
}

export async function myStreakCount(uid) {
  if (!db || !uid) return 0;
  const snap = await getDocs(query(collection(db, 'streaks'), where('memberIds', 'array-contains', uid)));
  return snap.docs.filter((d) => isNotSolo(d.data())).length;
}

// Idempotent: calling this on an already-streaking pair just returns the
// existing doc, so "Start a Streak" can safely be tapped again.
export async function startStreak(me, friend) {
  if (!db) return null;
  const id = pairIdOf(me.uid, friend.uid);
  const ref = doc(db, 'streaks', id);
  const existing = await getDoc(ref);
  if (existing.exists()) return { id, ...existing.data() };
  if ((await myStreakCount(me.uid)) >= MAX_ACTIVE_STREAKS) {
    throw Object.assign(new Error(`You can only have ${MAX_ACTIVE_STREAKS} streaks going at once.`), {
      userMessage: `You can only have ${MAX_ACTIVE_STREAKS} streaks going at once -- leave one first.`,
    });
  }
  const memberIds = [me.uid, friend.uid].sort();
  const data = {
    mode: 'dual',
    memberIds,
    memberNames: { [me.uid]: me.name || 'A traveler', [friend.uid]: friend.name || 'A traveler' },
    count: 0,
    best: 0,
    lastCompletedDay: null,
    freezesLeft: FREEZES_PER_MONTH,
    freezeMonth: monthKey(new Date()),
    frozenDays: [],
    recoveryUsedMonth: null,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return { id, ...data };
}

export async function leaveStreak(pairId) {
  if (!db) return;
  await deleteDoc(doc(db, 'streaks', pairId));
}

// The one field on the pair doc either member can set themselves -- which
// city today's (and every future day's, until changed) shared 3-card deck
// draws from (sharedDeck.js).
export async function setStreakCity(pairId, cityId) {
  if (!db) return;
  await updateDoc(doc(db, 'streaks', pairId), { cityId, updatedAt: serverTimestamp() });
}

// Today's 3 shared cards for this pair -- both members compute the exact
// same list independently (sharedDeck.js), no network round trip.
export function todaysCardIds(pairId, cityId) {
  if (!cityId) return [];
  return pickDailyCardIds(pairId, dayKey(new Date()), cityId);
}

// Rate + guess a card (item 2): rating first, guess only after. Both write
// into the same per-day entry doc, keyed by landmarkId so rating one card
// never touches another's data. `done` flips true once all
// DAILY_DECK_SIZE cards have both a rating and a guess -- close-streak-
// day.js re-derives the day's real card ids itself and verifies this
// rather than trusting the flag outright.
// The nested-object form here (`ratings: { [landmarkId]: verdict }`) is
// deliberate, not just style -- setDoc's merge:true deep-merges a nested
// object literal into the existing map field, but if this were instead a
// dotted STRING key on the top-level object (`{ [`ratings.${id}`]: verdict
// }`), setDoc treats it as one literal field named "ratings.xyz" rather
// than a path into a nested "ratings" map (that dotted-path interpretation
// is an updateDoc-only behavior, not shared by setDoc). Verified against
// the Firestore emulator directly: the dotted-key form silently wrote a
// bogus top-level "ratings.landmarkId" field forever, which every read in
// this app ignores (`entry.ratings?.[id]`) -- so a vote appeared to work
// (no error, ever) but was permanently invisible on every read, including
// after a reload. This exact bug shipped and reached production before it
// was caught.
export async function submitCardRating(pairId, uid, landmarkId, verdict) {
  if (!db) return;
  const today = dayKey(new Date());
  await setDoc(
    doc(db, 'streaks', pairId, 'days', today, 'entries', uid),
    { uid, ratings: { [landmarkId]: verdict }, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function submitCardGuess(pairId, uid, landmarkId, verdict, cardIds) {
  if (!db) return;
  const today = dayKey(new Date());
  const ref = doc(db, 'streaks', pairId, 'days', today, 'entries', uid);
  await setDoc(ref, { uid, guesses: { [landmarkId]: verdict }, updatedAt: serverTimestamp() }, { merge: true });
  // Recompute `done` from the entry we now expect to be complete, rather
  // than trusting a locally-tracked count -- a second device/tab writing
  // the same entry can't leave `done` out of sync with what's actually saved.
  const snap = await getDoc(ref);
  const entry = snap.data() || {};
  const done = (cardIds || []).every((id) => entry.ratings?.[id] && entry.guesses?.[id]);
  if (done) await setDoc(ref, { done: true, updatedAt: serverTimestamp() }, { merge: true });
  return done;
}

// Pings the server to check whether TODAY closes for this pair -- call
// after a card's rating+guess completes the day's deck. Safe to call any
// time; api/close-streak-day.js only ever advances the count when both
// members' entries actually cover today's real 3 cards.
export async function closeToday(pairId) {
  const today = dayKey(new Date());
  await fetch(`${API_BASE}/api/close-streak-day`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ pairId, dayId: today }),
  }).catch(() => {});
}

export function subscribeDayEntries(pairId, dayId, onEntries, onError) {
  if (!db || !pairId || !dayId) return () => {};
  return onSnapshot(
    collection(db, 'streaks', pairId, 'days', dayId, 'entries'),
    (snap) => onEntries(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))),
    onError
  );
}

// Spends one of the pair's monthly freezes to hold today -- if it turns out
// neither of you finishes today's quota, this keeps tomorrow's completion
// from resetting the count. Server-authoritative (api/use-streak-freeze.js):
// resets the monthly count first if the calendar month has turned over.
export async function spendFreeze(pairId) {
  const r = await fetch(`${API_BASE}/api/use-streak-freeze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ pairId, dayId: dayKey(new Date()) }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { userMessage: data?.error });
  return data;
}

// TEMPORARY, one-off correction -- not a normal capability, see
// api/reset-dual-streak.js's own note. Resets count/best/lastCompletedDay/
// freezes back to a fresh 0 without touching the pairing itself.
export async function resetDualStreak(pairId) {
  const r = await fetch(`${API_BASE}/api/reset-dual-streak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ pairId }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { userMessage: data?.error });
  return data;
}

// The 24h window after a break (item 7): both check in at the same landmark
// within 30 minutes (or, long-distance, each checks in anywhere within the
// window). Server-authoritative (api/complete-recovery-mission.js) -- it
// re-reads both members' real check-ins itself, same trust model as
// close-streak-day.js.
export async function completeRecoveryMission(pairId) {
  const r = await fetch(`${API_BASE}/api/complete-recovery-mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ pairId }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { userMessage: data?.error });
  return data;
}

const TASTE = { 'highly-recommend': 'love', 'worth-trying': 'unsure', 'probably-skip': 'hate' };
const MATCH_POINTS = {
  'love-love': 1, 'unsure-unsure': 1, 'hate-hate': 1,
  'love-unsure': 0.5, 'unsure-love': 0.5, 'unsure-hate': 0.5, 'hate-unsure': 0.5,
  'love-hate': 0, 'hate-love': 0,
};
const COMPATIBILITY_MIN_SHARED = 10;
const COMPATIBILITY_WINDOW = 50;

// Compatibility score (item 6): weighted match rate across landmarks BOTH
// of you have a real rating for, weighted toward the most recent 50. Built
// from real ratings only (reviews, not pick_feedback votes) -- reading a
// friend's votes isn't allowed by firestore.rules (pick_feedback is
// private to its own owner), so this is a smaller slice of the spec's
// "shared cards" than the full daily-deck version would be. "Guess
// accuracy" (the spec's second stat) isn't computable at all yet -- there's
// no partner-guess feature to measure.
export async function computeCompatibility(myUid, partnerUid) {
  const [mine, theirs] = await Promise.all([getUserReviews(myUid), getUserReviews(partnerUid)]);
  const mineMap = new Map(mine.filter((r) => r.ratingTier && r.landmarkId).map((r) => [r.landmarkId, r]));
  const theirsMap = new Map(theirs.filter((r) => r.ratingTier && r.landmarkId).map((r) => [r.landmarkId, r]));
  const sharedIds = [...mineMap.keys()].filter((id) => theirsMap.has(id));
  if (sharedIds.length < COMPATIBILITY_MIN_SHARED) return { sharedCount: sharedIds.length, score: null };
  const scored = sharedIds
    .map((id) => {
      const a = mineMap.get(id);
      const b = theirsMap.get(id);
      const atMs = Math.max(a.updatedAt?.seconds || 0, b.updatedAt?.seconds || 0);
      const points = MATCH_POINTS[`${TASTE[a.ratingTier]}-${TASTE[b.ratingTier]}`] ?? 0.5;
      return { atMs, points };
    })
    .sort((x, y) => y.atMs - x.atMs)
    .slice(0, COMPATIBILITY_WINDOW);
  const score = scored.reduce((sum, x) => sum + x.points, 0) / scored.length;
  return { sharedCount: sharedIds.length, score };
}

export { PICKS_STREAK_THRESHOLD };
