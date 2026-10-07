import { collection, doc, getDocs, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { pickMarkFields } from './pickMarks';
import { PICK_VOTE_PENDING_LIMIT, PICK_VOTE_RETRY_BASE_MS, PICK_VOTE_SAVE_ATTEMPTS, REQUEST_FOR_VALUES } from './maprConstants';
import { levelOfVerdict, planLearning } from './maprLearning';
import { voteWeight } from './tagScores';
import { scheduleTasteRecompute } from './tasteScoreStore';

export const PICK_VOTE_EVENT = 'lh-pick-vote';

// ✓ / ✗ / 🤷 on a Mapr pick: "I'd go" / "not for me" / "not sure". ✓ and ✗
// are a light, general-taste signal -- lighter than a rating, and
// context-dependent (you might skip a cathedral at night in Miami and still
// love cathedrals in Italy), so they nudge the region's tag scores by
// VOTE_DELTAS and count at half weight in the Taste Profile score, rather
// than ruling anything out; either way, that exact place is kept out of your
// picks for good, since it's a real, conclusive verdict. "Not sure" is
// different on purpose: it carries no taste signal at all and only snoozes
// the place for a week (see votedIds below).
//
// Stored in Firestore pick_feedback/{uid}_{landmarkId}, written FIRST; the
// localStorage copy (instant reads) is updated only after that write lands.
// Offline taps wait in a separate pending queue (not votes) until sent.

const KEY = (uid) => `lh-pick-feedback:${uid}`;

function readLocal(uid) {
  try {
    return JSON.parse(localStorage.getItem(KEY(uid)) || '{}') || {};
  } catch {
    return {};
  }
}

function writeLocal(uid, map) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(map));
  } catch {
    /* private mode */
  }
}

const PENDING_KEY = (uid) => `lh-pick-feedback-pending:${uid}`;

// Taps that could not be sent because the phone is offline. NOT votes: they
// are a retry queue, shown as "not saved yet", and each one is removed the
// moment its Firestore write lands (flushPendingPickVotes).
export function readPendingPickVotes(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY(uid)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writePending(uid, map) {
  try {
    const entries = Object.entries(map).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    const kept = entries.slice(-PICK_VOTE_PENDING_LIMIT);
    if (kept.length) localStorage.setItem(PENDING_KEY(uid), JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(PENDING_KEY(uid));
  } catch {
    /* private mode: a pending tap just is not remembered across a restart */
  }
}

// Account deletion: the device copy of saved taps and the pending retry queue.
export function clearLocalPickFeedback(uid) {
  try {
    localStorage.removeItem(KEY(uid));
  } catch {
    /* ignore */
  }
  clearPendingPickVotes(uid);
}

export function clearPendingPickVotes(uid) {
  try {
    localStorage.removeItem(PENDING_KEY(uid));
  } catch {
    /* ignore */
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The Firestore write, retried with doubling backoff. Throws the last error.
async function writeWithRetry(uid, entry, sleep = wait) {
  if (!db) throw new Error('pick-feedback-unavailable');
  let err;
  for (let i = 0; i < PICK_VOTE_SAVE_ATTEMPTS; i++) {
    if (i > 0) await sleep(PICK_VOTE_RETRY_BASE_MS * 2 ** (i - 1));
    try {
      await setDoc(doc(db, 'pick_feedback', `${uid}_${entry.landmarkId}`), { userId: uid, ...entry, updatedAt: serverTimestamp() });
      return;
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// Called only AFTER the Firestore write succeeded.
function recordSaved(uid, entry, landmark) {
  const map = readLocal(uid);
  const prior = map[entry.landmarkId]?.verdict;
  map[entry.landmarkId] = entry;
  writeLocal(uid, map);
  try {
    window.dispatchEvent(new Event(PICK_VOTE_EVENT));
  } catch {
    /* no window (tests/SSR) */
  }
  // Mapr learns from the tap (maprLearning.js): a lighter nudge than a
  // rating on the place's tags, plus the place's own score. Changing the tap
  // later takes the old tap's effect back out first.
  if (levelOfVerdict(entry.verdict) && landmark.region && db) {
    applyTapToProfile(uid, landmark, entry.verdict, entry.at, prior, voteWeight(entry.near, entry.region, entry.landmarkId, landmark)).catch(() => {});
  }
}

// Sends every pending tap (call when the phone is back online). A tap that
// still cannot be sent stays pending. Returns the entries that were saved.
export async function flushPendingPickVotes(uid, { sleep } = {}) {
  if (!uid || isOffline()) return [];
  const saved = [];
  for (const entry of Object.values(readPendingPickVotes(uid))) {
    try {
      await writeWithRetry(uid, entry, sleep);
    } catch {
      continue;
    }
    const cur = readPendingPickVotes(uid);
    // A newer offline tap on the same place replaced this one mid-flush: keep it.
    if (cur[entry.landmarkId]?.at === entry.at) delete cur[entry.landmarkId];
    writePending(uid, cur);
    recordSaved(uid, entry, { id: entry.landmarkId, region: entry.region, name: entry.name, categories: entry.categories });
    saved.push(entry);
  }
  return saved;
}

// Save a tap, database first. Resolves { status: 'saved', entry } once the
// pick_feedback doc is written (only then is the device copy updated), or
// { status: 'pending', entry } when the phone is offline (held as a retry,
// not a vote). Rejects when every attempt failed: the caller shows the error
// and offers a retry. requestFor ('solo' | 'group') rides along for a pick
// that answered a Mapr chat request.
export async function setPickFeedback({ uid, landmark, verdict, origin, requestFor = null, sleep }) {
  const entry = {
    landmarkId: landmark.id,
    region: landmark.region,
    name: landmark.name,
    categories: landmark.categories || [],
    verdict, // 'yes' | 'no' | 'unsure'
    at: Date.now(),
    near: origin ? { lat: Number(origin.lat.toFixed(2)), lng: Number(origin.lng.toFixed(2)) } : null,
    // pickSetId / pickSurface / pickShownAt: present only when this place was
    // shown as a Mapr pick to this user recently (see pickMarks.js).
    ...pickMarkFields(uid, landmark.id),
    ...(REQUEST_FOR_VALUES.includes(requestFor) ? { requestFor } : {}),
  };
  if (isOffline()) {
    writePending(uid, { ...readPendingPickVotes(uid), [landmark.id]: entry });
    return { status: 'pending', entry };
  }
  await writeWithRetry(uid, entry, sleep);
  // A newer tap on the same place may be waiting in the retry queue; this one wins.
  const pending = readPendingPickVotes(uid);
  if (pending[landmark.id]) {
    delete pending[landmark.id];
    writePending(uid, pending);
  }
  recordSaved(uid, entry, landmark);
  return { status: 'saved', entry };
}

async function applyTapToProfile(uid, landmark, verdict, nowMs, priorVerdict, tapWeight = 1) {
  const userRef = doc(db, 'users', uid);
  const placeRef = doc(db, 'users', uid, 'place_scores', landmark.id);
  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const placeSnap = await tx.get(placeRef);
    const { userPatch, ledger } = planLearning({
      user: userSnap.exists() ? userSnap.data() : {},
      prev: placeSnap.exists() ? placeSnap.data() : null,
      // A tap made before place_scores existed already moved the tags once
      // (applyVote); this lets a change of mind take that back out.
      legacy: priorVerdict ? { tap: { verdict: priorVerdict, region: landmark.region, categories: landmark.categories || [] } } : {},
      landmark,
      next: { tap: levelOfVerdict(verdict), tapWeight },
      nowMs,
    });
    if (userPatch) tx.set(userRef, userPatch, { merge: true });
    if (ledger) tx.set(placeRef, { ...ledger, updatedAt: serverTimestamp() });
  });
  scheduleTasteRecompute(uid);
}

// Synchronous (localStorage only, no Firestore round trip) -- for painting
// something instantly on mount instead of waiting on getPickFeedback's
// network read. getPickFeedback below still runs right after and reconciles
// with Firestore for the authoritative copy.
export function readLocalFeedback(uid) {
  return readLocal(uid);
}

export async function getPickFeedback(uid) {
  const map = readLocal(uid);
  if (db) {
    try {
      const snap = await getDocs(query(collection(db, 'pick_feedback'), where('userId', '==', uid)));
      for (const d of snap.docs) {
        const r = d.data();
        if (!map[r.landmarkId] || (r.at || 0) > (map[r.landmarkId].at || 0)) {
          map[r.landmarkId] = { landmarkId: r.landmarkId, region: r.region, name: r.name, categories: r.categories || [], verdict: r.verdict, at: r.at || 0, near: r.near || null, ...(r.pickSetId ? { pickSetId: r.pickSetId, pickSurface: r.pickSurface ?? null, pickShownAt: r.pickShownAt } : {}) };
        }
      }
      writeLocal(uid, map);
    } catch {
      /* fall back to the local copy */
    }
  }
  return map;
}

const SYNCED_FLAG_PREFIX = 'landmarkhunters.pickFeedbackSynced.';

// setPickFeedback's Firestore write is best-effort -- offline, or the rules
// not being deployed yet, silently leaves an entry living ONLY in this
// device's localStorage (see that function's own comment). That was
// invisible while the solo streak was purely a live, client-side
// computation (it read the local+Firestore merge via getPickFeedback), but
// api/ensure-solo-streak.js's server-side seed can only see Firestore --
// any streak day whose only 3-distinct-landmarks quota came from a
// local-only vote is invisible to it, and can quietly break the seeded
// count even after the timezone fix. Re-attempting each local entry's write
// gives it a fresh chance to land BEFORE the server reads pick_feedback to
// seed or repair a streak. One-time per device (a localStorage flag), not
// on every call -- the writes are idempotent (merge) but there's no reason
// to repeat them once they've gone through.
export async function syncLocalFeedbackToFirestore(uid) {
  if (!db || !uid) return;
  const flagKey = `${SYNCED_FLAG_PREFIX}${uid}`;
  try {
    if (localStorage.getItem(flagKey) === '1') return;
  } catch {
    /* private mode -- no flag to check, just sync every time (cheap, idempotent) */
  }
  const entries = Object.values(readLocal(uid));
  if (entries.length) {
    await Promise.all(
      entries.map((entry) =>
        setDoc(doc(db, 'pick_feedback', `${uid}_${entry.landmarkId}`), { userId: uid, ...entry, updatedAt: serverTimestamp() }, { merge: true }).catch(
          () => {}
        )
      )
    );
  }
  try {
    localStorage.setItem(flagKey, '1');
  } catch {
    /* private mode */
  }
}

// "Not sure" snoozes a pick instead of blacklisting it. Without a snooze,
// any reload of the deck (a location update, a profile change) brought the
// same card straight back seconds after you tapped it.
export const UNSURE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// Every landmark to keep out of your picks right now: a real ✓/✗ verdict
// hides it for good; "not sure" hides it for UNSURE_SNOOZE_MS, then it can
// come back.
export function votedIds(feedback, now = Date.now()) {
  return Object.values(feedback || {})
    .filter(
      (f) => f.verdict === 'yes' || f.verdict === 'no' || (f.verdict === 'unsure' && now - (f.at || 0) < UNSURE_SNOOZE_MS)
    )
    .map((f) => f.landmarkId);
}
