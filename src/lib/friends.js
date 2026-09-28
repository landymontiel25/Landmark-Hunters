import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  runTransaction,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { syncMyReviewVisibility } from './reviews';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Our own validation errors are already written for people -- tagging them
// with userMessage lets friendlyError() show them as-is instead of falling
// back to a generic "Something went wrong".
function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

export async function getUserProfile(uid) {
  if (!db || !uid) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// Live subscription to your own users/{uid} doc. A one-shot getDoc fired
// the instant auth restores on app open can lose that race (and then
// nothing ever asks again); a listener can't -- Firestore re-syncs it on
// its own once auth/connection are ready, and pushes every later write
// (a taste baseline save, a username claim) the moment it lands, with no
// manual reload() needed anywhere. `onProfile(data, { fresh })` -- fresh is
// false only for a snapshot served purely from the local cache.
export function subscribeUserProfile(uid, onProfile, onError) {
  if (!db || !uid) return () => {};
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      onProfile(snap.data(), { fresh: !snap.metadata.fromCache });
    },
    (err) => onError?.(err)
  );
}

// Claim a unique username. `usernames/{name}` doubles as the uniqueness lock.
export async function claimUsername(user, rawName) {
  const username = (rawName || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw userError('3–20 characters: lowercase letters, numbers, or _');
  }
  const unameRef = doc(db, 'usernames', username);
  const userRef = doc(db, 'users', user.uid);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(unameRef);
    if (existing.exists() && existing.data().uid !== user.uid) {
      throw userError('That username is already taken.');
    }
    const me = await tx.get(userRef);
    const oldName = me.exists() ? me.data().username : null;
    tx.set(unameRef, { uid: user.uid });
    tx.set(
      userRef,
      {
        uid: user.uid,
        username,
        displayName: user.displayName || username,
        email: (user.email || '').toLowerCase(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (oldName && oldName !== username) tx.delete(doc(db, 'usernames', oldName));
  });
  return username;
}

export async function findUserByUsername(rawName) {
  if (!db) return null;
  const username = (rawName || '').trim().toLowerCase().replace(/^@/, '');
  if (!username) return null;
  const unameSnap = await getDoc(doc(db, 'usernames', username));
  if (!unameSnap.exists()) return null;
  const userSnap = await getDoc(doc(db, 'users', unameSnap.data().uid));
  return userSnap.exists() ? userSnap.data() : null;
}

// Minimal searchable profile so friends can find each other by email.
export async function upsertUserProfile(user) {
  if (!db || !user) return;
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      displayName: user.displayName || user.email,
      email: (user.email || '').toLowerCase(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Public: your reviews (comments, stars, photos) are visible to everyone.
// Private (default): only friends can see them -- matches the original
// friends-only photo rule this generalizes, now enforced in firestore.rules
// rather than just hidden client-side.
export async function setProfileVisibility(uid, isPublic) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { public: !!isPublic, updatedAt: serverTimestamp() }, { merge: true });
  // Your reviews carry a copy of this for comment lists (see reviews.js).
  await syncMyReviewVisibility(uid, !!isPublic).catch(() => {});
}

// Turns off Mapr's on-device "you keep going here" habit prompt (see
// src/lib/habitTracking.js) -- defaults to on, so absence of this field
// means enabled.
export async function setHabitTrackingEnabled(uid, enabled) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { habitTrackingEnabled: !!enabled, updatedAt: serverTimestamp() }, { merge: true });
}

// Whether Mapr keeps learning location even with the app closed (see
// src/lib/backgroundLocation.js + useBackgroundLocationSync.js) -- opt-in,
// asked once during onboarding and toggleable anytime from Settings.
// Defaults to off, unlike habit tracking, since this one asks for iOS's
// "Always" location permission rather than something already granted.
export async function setBackgroundLocationEnabled(uid, enabled) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { backgroundLocationEnabled: !!enabled, updatedAt: serverTimestamp() }, { merge: true });
}

// Written by the background watcher itself (throttled -- see
// useBackgroundLocationSync.js), not by anything the user directly triggers.
// Lets Mapr Picks/plan-ai use a fresh location for someone who hasn't opened
// the app since arriving in a new city, instead of waiting for their next
// GPS fix inside the app.
export async function saveLastKnownLocation(uid, { lat, lng, accuracy, at }) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    { lastKnownLocation: { lat, lng, accuracy: accuracy ?? null, at: at || Date.now() } },
    { merge: true }
  );
}

// Whether this account wants push notifications at all -- opt-in, off by
// default, same reasoning as background location: turning it on means an
// OS permission prompt. Checked server-side by api/_lib/push.js before it
// bothers sending anything (see usePushNotificationsSync.js).
export async function setPushNotificationsEnabled(uid, enabled) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { pushNotificationsEnabled: !!enabled, updatedAt: serverTimestamp() }, { merge: true });
}

// One entry per device that's ever registered, keyed by its own FCM token --
// re-registering the same device overwrites its own entry (idempotent), and
// a dead token can be dropped by key alone (see sendPushToUser in
// api/_lib/push.js) without touching any other device's.
export async function savePushToken(uid, token, platform) {
  if (!db || !uid || !token) return;
  await setDoc(
    doc(db, 'users', uid),
    { pushTokens: { [token]: { platform, updatedAt: serverTimestamp() } } },
    { merge: true }
  );
}

export async function removePushToken(uid, token) {
  if (!db || !uid || !token) return;
  await updateDoc(doc(db, 'users', uid), { [`pushTokens.${token}`]: deleteField() });
}

// The free-text "tell Mapr what you already love" blurb -- optional, set at
// onboarding (TasteIntroStep) or anytime after from Settings. Same
// users/{uid} doc getUserProfile already reads, so it's available for free
// via FriendsContext's myProfile once saved. Fed to the AI verbatim (see
// api/plan-ai.js/api/mapr-picks.js's TASTE INTRO section) rather than
// parsed into categories -- "I love racing, steak, pickleball, the boat...
// I like fancy things" is exactly the kind of free-form context an LLM
// reads better than any keyword list could.
export async function saveTasteIntro(uid, text) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { tasteIntro: (text || '').trim().slice(0, 2000), updatedAt: serverTimestamp() }, { merge: true });
}

// Answer to "You really love [tag]. Want us to lean more into it?" (see
// TagCapPrompt). One answer per tag, applied in every region. Either answer
// is stored, which is what stops it asking again.
export async function answerTagCapPrompt(uid, tag, answer, note) {
  if (!db || !uid || !tag) return;
  const text = (note || '').trim().slice(0, 500);
  await setDoc(
    doc(db, 'users', uid),
    {
      capAnswers: { [tag]: answer === 'yes' ? 'yes' : 'no' },
      ...(text ? { capNotes: { [tag]: text } } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// One-time replay of ratings saved before the current tag-score version.
// Replaces the maps whole (updateDoc, not a deep merge) since the replay
// covers every review the user has.
export async function saveRebuiltTagScores(uid, { tagScores, tagScoresAt, tagCounts }, version) {
  if (!db || !uid) return;
  await updateDoc(doc(db, 'users', uid), { tagScores, tagScoresAt, tagCounts, tagScoresVersion: version });
}

// Marks Mapr Picks as seen today, so a later day can count them as ignored
// if the user never went (see settleShownPicks in tagScores.js).
export async function recordShownPicks(uid, picks, today) {
  if (!db || !uid || !picks.length) return;
  const picksShown = {};
  for (const p of picks) (picksShown[p.region] ||= {})[p.id] = today;
  await setDoc(doc(db, 'users', uid), { picksShown }, { merge: true });
}

// Writes settleShownPicks' result: both ignore maps replaced whole, plus a
// small tag-score nudge for any pick ignored IGNORE_LIMIT times.
export async function saveSettledPicks(uid, { picksShown, timesShownNotVisited, scorePatches }) {
  if (!db || !uid) return;
  const update = { picksShown, timesShownNotVisited };
  for (const { region, tag, value, at } of scorePatches) {
    update[`tagScores.${region}.${tag}`] = value;
    update[`tagScoresAt.${region}.${tag}`] = at;
  }
  await updateDoc(doc(db, 'users', uid), update);
}

// The structured like/dislike answers from TasteNudgeCard -- separate from
// the free-text tasteIntro above so re-editing it (see TasteProfileCard's
// Edit button) cleanly REPLACES the old picks instead of appending onto a
// growing sentence. { [categoryId]: { [example]: 'like' | 'dislike' } };
// setDoc with merge:true replaces this whole field's value (it's a single
// top-level key), so an edit-and-resubmit never leaves stale picks behind.
// categoryNotes ({ [categoryId]: string }) is the per-category "Comment"
// field next to each question -- e.g. "no pepper on my steak" under Food --
// same replace-on-resubmit behavior as baseline itself.
export async function saveTasteBaseline(uid, { baseline, notes, categoryNotes }) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    {
      tasteBaseline: baseline || {},
      tasteBaselineNotes: (notes || '').trim().slice(0, 2000),
      tasteBaselineCategoryNotes: categoryNotes || {},
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Home address + coords, used to zero out points for check-ins within
// HOME_RADIUS_METERS (see src/lib/leaderboard.js) -- also closes the
// self-submitted-landmark-near-home exploit. Same users/{uid} doc
// getUserProfile already reads, so it's available for free via
// FriendsContext's myProfile once saved.
export async function saveHomeLocation(uid, { address, lat, lng }) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    { homeAddress: address || '', homeCoords: { lat, lng }, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Stamps when this account was last seen. Written once per session (on
// auth), not per action -- enough to answer "did they come back within 30
// days?" for the retention-by-ratings-count analysis without write spam.
export async function touchLastActive(uid) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { lastActiveAt: serverTimestamp() }, { merge: true });
}

export async function findUserByEmail(email) {
  if (!db) return null;
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', e)));
  return snap.docs[0]?.data() || null;
}

// Have I already sent toUid a request? A direct getDoc on the deterministic
// friend_requests/{fromUid}_{toUid} id would throw permission-denied when the
// doc doesn't exist yet (rules can't tell "not found" from "not yours" on a
// null resource), so this queries by "from" instead -- list rules evaluate
// per returned (i.e. existing) document, sidestepping that.
export async function hasPendingRequestTo(fromUid, toUid) {
  if (!db || !fromUid || !toUid) return false;
  const snap = await getDocs(query(collection(db, 'friend_requests'), where('from', '==', fromUid)));
  return snap.docs.some((d) => d.data().to === toUid);
}

export async function sendFriendRequest(fromUser, toUser) {
  if (fromUser.uid === toUser.uid) throw userError("That's your own account.");
  const edge = await getDoc(doc(db, 'friend_edges', `${fromUser.uid}_${toUser.uid}`));
  if (edge.exists()) throw userError('You two are already friends.');
  await setDoc(doc(db, 'friend_requests', `${fromUser.uid}_${toUser.uid}`), {
    from: fromUser.uid,
    fromName: fromUser.username || fromUser.displayName || fromUser.email,
    to: toUser.uid,
    toName: toUser.username || toUser.displayName || toUser.email,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function listIncomingRequests(uid) {
  // Single-field query (no composite index). Accepted/declined requests are
  // deleted, so everything addressed to you is a pending request.
  const snap = await getDocs(query(collection(db, 'friend_requests'), where('to', '==', uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptRequest(req) {
  const batch = writeBatch(db);
  // Two directed edges so each user can query their own friends.
  batch.set(doc(db, 'friend_edges', `${req.to}_${req.from}`), {
    owner: req.to,
    friend: req.from,
    friendName: req.fromName,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'friend_edges', `${req.from}_${req.to}`), {
    owner: req.from,
    friend: req.to,
    friendName: req.toName,
    createdAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'friend_requests', req.id));
  await batch.commit();
}

export async function declineRequest(req) {
  await deleteDoc(doc(db, 'friend_requests', req.id));
}

export async function listFriends(uid) {
  const snap = await getDocs(query(collection(db, 'friend_edges'), where('owner', '==', uid)));
  return snap.docs.map((d) => d.data());
}
