import { doc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { PICKABLE_REGIONS } from '../data/regions';
import { allSwipeCards, tagDeltasFromAnswers, placesIntro } from './onboardingCards';
import { TAG_CAP, TAG_FLOOR, decayFactor, GLOBAL_TASTE, hasGlobalTaste } from './tagScores';
import { ONBOARDING_VERSION, ONBOARDING_NOTICE_MESSAGE, onboardingNoticeId } from './onboardingVersion';

const cardsByWord = new Map(allSwipeCards().map((c) => [c.word, c]));
export const cardForWord = (word) => cardsByWord.get(word) || null;

// In memory: [{ card, answer }]. In Firestore: [{ word, answer }]. A list, not
// a { word: answer } map, because a merge write replaces a list whole (so Undo
// really removes an answer) while it merges maps key by key.
export const answersToPairs = (list) => list.map(({ card, answer }) => ({ word: card.word, answer }));
export const pairsToAnswers = (pairs) =>
  (Array.isArray(pairs) ? pairs : [])
    .map(({ word, answer }) => ({ card: cardForWord(word), answer }))
    .filter((a) => a.card && ['love', 'dislike', 'unsure'].includes(a.answer));

// The answers a screen starts from. What they did earlier in this same run
// wins, then what they answered the last time they did onboarding, then a
// "love it" for every card whose category they already saved as a preference,
// so returning users aren't asked what they've already told us.
export function prefillAnswers({ cardWords, progress, profile, savedInterests = [] }) {
  const inDeck = new Set(cardWords);
  const byWord = new Map();
  for (const a of pairsToAnswers(profile?.swipeAnswers)) if (inDeck.has(a.card.word)) byWord.set(a.card.word, a);
  for (const w of cardWords) {
    const card = cardForWord(w);
    if (card && !byWord.has(w) && savedInterests.includes(card.tag)) byWord.set(w, { card, answer: 'love' });
  }
  for (const a of pairsToAnswers(progress?.answers)) if (inDeck.has(a.card.word)) byWord.set(a.card.word, a);
  return cardWords.map((w) => byWord.get(w)).filter(Boolean);
}

// Marks an account as created through sign-up, which is what makes onboarding
// start on its own for it (see onboardingStatus). Written once, at creation.
// Also stamps createdAt (server time) -- the account's creation moment, which
// firestore.rules lets be written once and never changed. Accounts made before
// this existed are filled in by the admin backfill (api/admin-jobs.js, run from the admin dashboard).
export async function markNewSignup(uid) {
  if (!db || !uid) return;
  await setDoc(doc(db, 'users', uid), { onboardingSource: 'signup', createdAt: serverTimestamp() }, { merge: true });
}

// Where the person is in the flow, so closing the app resumes there. Answers
// are saved as they swipe. setDoc merge keeps the write safe even when it
// races the profile doc's own creation.
export async function saveOnboardingProgress(uid, patch) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    { onboardingProgress: { ...patch, version: ONBOARDING_VERSION, updatedAt: Date.now() } },
    { merge: true }
  );
}

// The flow ended: drop the saved progress, so nothing resumes. A new account
// that ended without finishing the cards stops counting as "new" (which would
// pull it back into the flow every time Profile opens) and becomes an
// account with onboarding still to do: notification and banner, no lock.
export async function endOnboardingFlow(uid, { complete, isNew }) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    {
      onboardingProgress: deleteField(),
      ...(!complete && isNew ? { onboardingSource: 'signup-skipped' } : {}),
    },
    { merge: true }
  );
}

const clamp = (v) => Math.max(TAG_FLOOR, Math.min(TAG_CAP, v));

// Turns swipe answers into the per-region tagScores Mapr Picks already ranks
// by, so they count from the first picks request. Answers are stored on the
// account as a whole, not per city, so each pickable region gets the same
// seed. Redoing onboarding applies only the change from last time
// (previousDeltas), so a repeat never doubles up.
export function seedTagScores(profile, answers, now = Date.now(), cityRegions = PICKABLE_REGIONS.map((r) => r.id), places = []) {
  // The one overall taste (tagScores.GLOBAL_TASTE) gets the seed once, like
  // any city map; until an account has it, useGlobalTaste builds it with the
  // swipe answers included.
  const regions = hasGlobalTaste(profile) ? [...cityRegions, GLOBAL_TASTE] : cityRegions;
  const deltas = tagDeltasFromAnswers(answers, places);
  const previous = profile?.onboardingSwipeDeltas || {};
  const tags = new Set([...Object.keys(deltas), ...Object.keys(previous)]);
  const tagScores = {};
  const tagScoresAt = {};
  for (const region of regions) {
    for (const tag of tags) {
      const change = (deltas[tag] || 0) - (previous[tag] || 0);
      if (!change) continue;
      const current = Number(profile?.tagScores?.[region]?.[tag]) || 0;
      const decayed = current * decayFactor(profile?.tagScoresAt?.[region]?.[tag], now);
      (tagScores[region] ||= {})[tag] = clamp(decayed + change);
      (tagScoresAt[region] ||= {})[tag] = now;
    }
  }
  return { deltas, tagScores, tagScoresAt };
}

// Same wording the Test tab feeds Mapr: the card words in prose. The free-text
// notes live in tasteIntro, saved by their own step, so only the words go here.
export function swipeSummary(answers, places = []) {
  const words = (a) => answers.filter((x) => x.answer === a).map((x) => x.card.word);
  const parts = [];
  if (words('love').length) parts.push(`Loves: ${words('love').join(', ')}.`);
  if (words('dislike').length) parts.push(`Doesn't like: ${words('dislike').join(', ')}.`);
  if (places.length) parts.push(placesIntro(places));
  // No trailing period: composeTasteIntro joins the pieces with ". ".
  return parts.join(' ').replace(/\.$/, '');
}

// Writes the swipes to the account: the raw answers, the summary Mapr reads
// and the tag-score seed, so Mapr uses whatever was answered even if the deck
// wasn't finished. Only `complete` records the version that clears the
// notification and banner. Progress stays until the whole flow is done.
//
// `places` is the "10 places you visit most" step (landmarks with name and
// categories). They count toward the tag-score seed and the text Mapr reads,
// and are stored as { regionId, id, name } so the step can be pre-filled.
export async function saveOnboardingResults(uid, profile, answers, { complete, places = [] }) {
  if (!db || !uid) return;
  const { deltas, tagScores, tagScoresAt } = seedTagScores(profile, answers, Date.now(), undefined, places);
  await setDoc(
    doc(db, 'users', uid),
    {
      ...(complete ? { onboardingVersion: ONBOARDING_VERSION } : {}),
      swipeAnswers: answersToPairs(answers),
      swipeSummary: swipeSummary(answers, places),
      ...(places.length ? { onboardingPlaces: places.map((l) => ({ regionId: l.regionId, id: l.id, name: l.name })) } : {}),
      onboardingSwipeDeltas: deltas,
      ...(Object.keys(tagScores).length ? { tagScores, tagScoresAt } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// "Onboarding has been updated" for accounts that predate this version.
// The notification is created first and the profile marker second: if the
// notification write fails the marker stays unset and the next load retries.
export async function sendOnboardingNotice(uid) {
  if (!db || !uid) return;
  const noticeRef = doc(db, 'notifications', onboardingNoticeId(uid));
  try {
    await setDoc(noticeRef, {
      uid,
      type: 'onboarding_update',
      message: ONBOARDING_NOTICE_MESSAGE,
      landmarkId: null,
      groupTripId: null,
      featureRequestId: null,
      bugReportId: null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // A retry after the marker write below failed finds its own notification
    // already there, and setDoc over an existing doc is an update --
    // firestore.rules only lets the owner flip `read`. Do just that.
    if (err?.code !== 'permission-denied') throw err;
    await updateDoc(noticeRef, { read: false });
  }
  await setDoc(doc(db, 'users', uid), { onboardingNoticeVersion: ONBOARDING_VERSION }, { merge: true });
}

// Puts the notification back to unread. Fails quietly if it doesn't exist
// (updateDoc rejects on a missing doc); the caller ignores that.
export async function resurfaceOnboardingNotice(uid) {
  if (!db || !uid) return;
  await updateDoc(doc(db, 'notifications', onboardingNoticeId(uid)), { read: false });
}

// Test-tab tool: puts an account back to "never did onboarding" so the update
// notification and banner can be tried again. Clears the version, sign-up
// marker, notice marker and saved progress, and deletes the notification.
// Earlier swipe answers stay, so the pre-fill can be tried too.
export async function resetOnboarding(uid) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'users', uid),
    {
      onboardingVersion: deleteField(),
      onboardingSource: deleteField(),
      onboardingNoticeVersion: deleteField(),
      onboardingProgress: deleteField(),
    },
    { merge: true }
  );
  await deleteDoc(doc(db, 'notifications', onboardingNoticeId(uid))).catch(() => {});
}
