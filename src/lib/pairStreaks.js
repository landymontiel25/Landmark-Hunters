import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
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

export const FREEZES_PER_MONTH = 2;

// Dual streaks (Dual Streak spec, phase 3 MVP): a streak belongs to a pair
// of friends, not a person. This is a deliberately smaller slice of the
// full spec -- no shared 3-cards-a-day deck yet (item 3's "chosen by a
// server function from a pair-day ID"), no squads, and the compatibility
// score's second stat ("guess accuracy") isn't computable yet since there's
// no partner-guess feature to measure. What IS real: a pair doc, a daily
// entry each member writes for themself, a server-authoritative day-close,
// shared freezes, a recovery mission, and a compatibility score computed
// from real ratings/votes both members already made. Reusing
// PICKS_STREAK_THRESHOLD/todaysActionCount (the same "3 distinct landmarks
// today" quota solo streaks used) as each person's own daily bar, since
// Mapr Travel Picks already produces that number.
//
// Data model:
//   streaks/{pairId}: memberIds, memberNames, count, best, lastCompletedDay,
//     freezesLeft, freezeMonth, frozenDays, recoveryUsedMonth, createdAt.
//     count/best/lastCompletedDay/freezesLeft/freezeMonth/frozenDays/
//     recoveryUsedMonth are server-authority only -- firestore.rules blocks
//     client writes to an existing doc entirely, so the only way they ever
//     change is api/close-streak-day.js, api/use-streak-freeze.js, and
//     api/complete-recovery-mission.js (admin SDK, bypasses rules).
//   streaks/{pairId}/days/{dayId}/entries/{uid}: done, count, updatedAt --
//     each member writes only their own entry (rules-enforced).

export function pairIdOf(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

export const MAX_ACTIVE_STREAKS = 3;

export function subscribeMyStreaks(uid, onStreaks, onError) {
  if (!db || !uid) return () => {};
  const q = query(collection(db, 'streaks'), where('memberIds', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => onStreaks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function myStreakCount(uid) {
  if (!db || !uid) return 0;
  const snap = await getDocs(query(collection(db, 'streaks'), where('memberIds', 'array-contains', uid)));
  return snap.size;
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

// Today's entry, written by the person themself once they've hit the daily
// quota (see usePairStreakSync.js). Safe to call more than once a day --
// it's a merge, and api/close-streak-day.js is what actually decides
// whether the pair's count moves.
export async function submitMyEntry(pairId, uid, { done, count }) {
  if (!db) return;
  const today = dayKey(new Date());
  await setDoc(
    doc(db, 'streaks', pairId, 'days', today, 'entries', uid),
    { uid, done: !!done, count: count || 0, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return today;
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
  const r = await fetch('/api/use-streak-freeze', {
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
  const r = await fetch('/api/complete-recovery-mission', {
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
