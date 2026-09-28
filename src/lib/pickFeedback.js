import { collection, doc, getDocs, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { applyVote, VOTE_DELTAS } from './tagScores';

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
// Stored two ways: localStorage (instant, always works) and Firestore
// pick_feedback/{uid}_{landmarkId} (best-effort; survives a new phone).

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

export async function setPickFeedback({ uid, landmark, verdict, origin }) {
  const entry = {
    landmarkId: landmark.id,
    region: landmark.region,
    name: landmark.name,
    categories: landmark.categories || [],
    verdict, // 'yes' | 'no' | 'unsure'
    at: Date.now(),
    near: origin ? { lat: Number(origin.lat.toFixed(2)), lng: Number(origin.lng.toFixed(2)) } : null,
  };
  const map = readLocal(uid);
  const prior = map[landmark.id]?.verdict;
  map[landmark.id] = entry;
  writeLocal(uid, map);
  try {
    window.dispatchEvent(new Event(PICK_VOTE_EVENT));
  } catch {
    /* no window (tests/SSR) */
  }
  if (!db) return entry;
  try {
    await setDoc(doc(db, 'pick_feedback', `${uid}_${landmark.id}`), { userId: uid, ...entry, updatedAt: serverTimestamp() });
  } catch {
    /* rules not deployed yet, or offline -- the local copy still counts */
  }
  // A place is only ever scored once: a ✓/✗ removes it from picks for good.
  if (VOTE_DELTAS[verdict] && !VOTE_DELTAS[prior] && landmark.region && landmark.categories?.length) {
    applyVoteToProfile(uid, landmark, verdict, entry.at).catch(() => {});
  }
  return entry;
}

async function applyVoteToProfile(uid, landmark, verdict, nowMs) {
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const u = snap.exists() ? snap.data() : {};
    const region = landmark.region;
    const next = applyVote(
      { scores: u.tagScores?.[region], at: u.tagScoresAt?.[region] },
      landmark.categories,
      verdict,
      nowMs
    );
    if (!Object.keys(next.scores).length) return;
    tx.set(userRef, { tagScores: { [region]: next.scores }, tagScoresAt: { [region]: next.at } }, { merge: true });
  });
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
          map[r.landmarkId] = { landmarkId: r.landmarkId, region: r.region, name: r.name, categories: r.categories || [], verdict: r.verdict, at: r.at || 0, near: r.near || null };
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
