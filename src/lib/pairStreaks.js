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
import { dayKey, PICKS_STREAK_THRESHOLD } from './streaks';

// Dual streaks (Dual Streak spec, phase 3 MVP): a streak belongs to a pair
// of friends, not a person. This is a deliberately smaller slice of the
// full spec -- no shared 3-cards-a-day deck yet (item 3's "chosen by a
// server function from a pair-day ID"), no freezes, no recovery, no
// compatibility score, no squads. What IS real: a pair doc, a daily entry
// each member writes for themself, and a server-authoritative day-close
// that decides whether the streak count actually advances. Reusing
// PICKS_STREAK_THRESHOLD/todaysActionCount (the same "3 distinct landmarks
// today" quota solo streaks used) as each person's own daily bar, since
// Mapr Travel Picks already produces that number.
//
// Data model:
//   streaks/{pairId}: memberIds, memberNames, count, best, lastCompletedDay,
//     createdAt. count/best/lastCompletedDay are server-authority only --
//     firestore.rules blocks client writes to an existing doc entirely, so
//     the only way they ever change is api/close-streak-day.js (admin SDK,
//     bypasses rules).
//   streaks/{pairId}/days/{dayId}/entries/{uid}: done, count, updatedAt --
//     each member writes only their own entry (rules-enforced).

export function pairIdOf(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

const MAX_ACTIVE_STREAKS = 3;

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

export { PICKS_STREAK_THRESHOLD };
