import { normalizeCategories } from '../data/regions';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  collection,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';

// User-created landmarks (e.g. a dorm hall not yet in the built-in catalog)
// live in their own Firestore collection and get merged onto the map
// alongside the static ones. Check-ins on them reuse the same claimCheckIn
// flow as any other landmark -- it only ever needs id/name/region. No
// approval queue -- by request, every submission is live immediately, for
// everyone. (The Firestore rules still require a fresh submission's write
// to include status: "pending" and nothing here ever changes it -- that's
// just the rules' own internal enforcement token, not a real approval
// gate. Nothing in the app reads or shows that value anymore.)
const withCategories = (l) => (l.categories ? { ...l, categories: normalizeCategories(l.categories) } : l);

export async function getCustomLandmarks() {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'custom_landmarks'));
  return snap.docs.map((d) => withCategories({ docId: d.id, ...d.data() }));
}

// Direct lookup by id -- the doc id and the `id` field are supposed to
// always be the same value (set at creation below, and the create rule in
// firestore.rules now enforces docId === id server-side too), so
// LandmarkDetail can fetch a single custom landmark the same way it'd look
// one up in the static catalog.
export async function getCustomLandmark(id) {
  if (!db || !id) return null;
  const snap = await getDoc(doc(db, 'custom_landmarks', id));
  if (snap.exists()) return withCategories({ docId: snap.id, ...snap.data() });
  // Fallback for a record whose own Firestore document id doesn't actually
  // match its `id` field -- e.g. one written before the create rule above
  // existed to enforce that. Without this, a pin like that still renders
  // fine on the map (getCustomLandmarks below, an unfiltered read of every
  // doc) but its own detail page always 404s, so it can never be opened to
  // edit or delete -- a dead pin nobody can clear. Reuses that same
  // already-working bulk read rather than a new filtered query, so this
  // doesn't risk a different list-vs-get rules outcome for a query shape
  // that's never been verified against the emulator.
  const all = await getCustomLandmarks();
  return all.find((l) => l.id === id) || null;
}

// Reject after `ms` so a stalled Storage upload never hangs the submission.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), ms))]);
}

export async function uploadLandmarkPhoto(landmarkId, userId, file) {
  if (!storage) throw new Error('Photo upload is not set up yet.');
  const path = `landmark_photos/${landmarkId}/${userId}.jpg`;
  const storageRef = ref(storage, path);
  await withTimeout(uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' }), 20000);
  return withTimeout(getDownloadURL(storageRef), 10000);
}

// `categories`/`images`/`summary`/`facts`/`free`/`typicalMinutes` make this
// render as a full landmark (LandmarkDetail, LandmarkThumb, the map popup)
// instead of a bare pin -- filled in by the AI verification step before this
// is ever called. status: "pending" is required by the Firestore rules'
// create check (see firestore.rules) but otherwise unused -- getCustomLandmarks
// returns every submission immediately, no approval step.
export async function addCustomLandmark({
  region,
  name,
  lat,
  lng,
  userId,
  categories = [],
  images = [],
  summary = '',
  facts = [],
  free = true,
  typicalMinutes = 15,
  hours = null,
}) {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = {
    region,
    id,
    name,
    lat,
    lng,
    categories,
    images,
    summary,
    facts,
    free,
    typicalMinutes,
    status: 'pending',
    createdBy: userId || null,
    createdAt: serverTimestamp(),
  };
  if (hours) data.hours = hours;
  await setDoc(doc(db, 'custom_landmarks', id), data);
  return { docId: id, ...data };
}

// Only the submitter or an admin can call this -- the Firestore rules
// enforce that independently of this client code (used by "Remove Pin" on
// the map).
export async function deleteCustomLandmark(docId) {
  await deleteDoc(doc(db, 'custom_landmarks', docId));
}

// Admin Mode (Settings -> "Admin Mode") -- edits any field of a
// user-submitted landmark directly: name, category, facts, summary, free,
// typicalMinutes, images, even lat/lng (moving the pin). The Firestore
// rules only let the admin's own account (ADMIN_EMAILS in lib/admins.js)
// write here with no field restriction; every other signed-in account is
// still limited to the reportedBy-only update reportCustomLandmark uses.
// The change is immediate and permanent for everyone, same as a built-in
// catalog entry -- there's no draft/preview step.
export async function updateCustomLandmark(docId, fields) {
  await updateDoc(doc(db, 'custom_landmarks', docId), fields);
}

// Same reportedBy-array pattern as reviews.js -- firestore.rules hides a
// submission (photo, name, everything) from everyone but the submitter and
// admins once enough distinct people have reported it.
export async function reportCustomLandmark(reporterUid, docId) {
  await updateDoc(doc(db, 'custom_landmarks', docId), { reportedBy: arrayUnion(reporterUid) });
}
