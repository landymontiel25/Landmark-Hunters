import { normalizeCategories, canonicalRegionId } from '../data/regions';
import { sharedRead, invalidating } from './sharedRead';
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
import { db, storage, auth } from './firebase';
import { isAdmin } from './admins';
import { shrinkPhoto } from './shrinkPhoto';
import { settleWrite } from './offlineWrite';

// Stable region for a custom landmark added farther than the attribution
// radius from any curated city. Used end to end (URL, check-ins, reviews,
// duplicate check) instead of a literal null, which turned into the string
// "null" in routes and Firestore keys.
export const CUSTOM_REGION = 'custom';
export const normalizeRegion = (r) => (r && r !== 'null' && r !== 'undefined' ? r : CUSTOM_REGION);

// User-created landmarks (e.g. a dorm hall not yet in the built-in catalog)
// live in their own Firestore collection and get merged onto the map
// alongside the static ones. Check-ins on them reuse the same claimCheckIn
// flow as any other landmark -- it only ever needs id/name/region. No
// approval queue -- by request, every submission is live immediately, for
// everyone. (The Firestore rules still require a fresh submission's write
// to include status: "pending" and nothing here ever changes it -- that's
// just the rules' own internal enforcement token, not a real approval
// gate. Nothing in the app reads or shows that value anymore.)
// Also normalizes a missing/legacy "null" region so old docs stay readable.
const withCategories = (l) => {
  const out = { ...l, region: canonicalRegionId(normalizeRegion(l.region)) };
  return l.categories ? { ...out, categories: normalizeCategories(l.categories) } : out;
};

export function getCustomLandmarks() {
  return sharedRead('custom_landmarks', loadCustomLandmarks);
}

async function loadCustomLandmarks() {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'custom_landmarks'));
  // firestore.rules can't enforce the hide-once-reported rule on a list
  // query, so it's applied here: hidden from everyone but the submitter
  // and the admin once two people have reported it.
  let me = null;
  try {
    me = auth?.currentUser || null;
  } catch {
    me = null;
  }
  return snap.docs
    .map((d) => withCategories({ docId: d.id, ...d.data() }))
    .filter((l) => (l.reportedBy?.length || 0) < 2 || (me && (l.createdBy === me.uid || isAdmin(me.email))));
}

// Direct lookup by id -- the doc id and the `id` field are supposed to
// always be the same value (set at creation below, and the create rule in
// firestore.rules now enforces docId === id server-side too), so
// LandmarkDetail can fetch a single custom landmark the same way it'd look
// one up in the static catalog.
export async function getCustomLandmark(id) {
  if (!db || !id) return null;
  let snap;
  try {
    snap = await getDoc(doc(db, 'custom_landmarks', id));
  } catch (e) {
    // firestore.rules refuse a direct read of a landmark that two people have
    // reported (only its submitter and the admin may open it). To everyone
    // else that is simply "gone" -- not an error worth "Try signing out and
    // back in", which is what the permission-denied surfaced as.
    if (e?.code === 'permission-denied') return null;
    throw e;
  }
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
  // Full-size phone photos can exceed storage.rules' 8 MB cap.
  const body = await shrinkPhoto(file);
  await withTimeout(uploadBytes(storageRef, body, { contentType: body.type || 'image/jpeg' }), 20000);
  return withTimeout(getDownloadURL(storageRef), 10000);
}

// `categories`/`images`/`summary`/`facts`/`free`/`typicalMinutes` make this
// render as a full landmark (LandmarkDetail, LandmarkThumb, the map popup)
// instead of a bare pin -- filled in by the AI verification step before this
// is ever called. status: "pending" is required by the Firestore rules'
// create check (see firestore.rules) but otherwise unused -- getCustomLandmarks
// returns every submission immediately, no approval step.
async function _addCustomLandmark({
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
  topic = null,
}) {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = {
    region: normalizeRegion(region),
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
  // What kind of place this specifically is ("Peruvian restaurant"), from
  // the AI research step -- phrases the rating question (tierQuestion in
  // ratingFlow.js). Left off entirely when research didn't find one.
  if (topic) data.topic = topic;
  await settleWrite(setDoc(doc(db, 'custom_landmarks', id), data));
  return { docId: id, ...data };
}

// Only the submitter or an admin can call this -- the Firestore rules
// enforce that independently of this client code (used by "Remove Pin" on
// the map).
async function _deleteCustomLandmark(docId) {
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
async function _updateCustomLandmark(docId, fields) {
  await updateDoc(doc(db, 'custom_landmarks', docId), fields);
}

// Same reportedBy-array pattern as reviews.js -- firestore.rules hides a
// submission (photo, name, everything) from everyone but the submitter and
// admins once enough distinct people have reported it.
async function _reportCustomLandmark(reporterUid, docId) {
  await updateDoc(doc(db, 'custom_landmarks', docId), { reportedBy: arrayUnion(reporterUid) });
}

// What the check-in sheet needs from a landmark that was just added. The
// rating questions are chosen from its categories and topic ("Do you like
// Peruvian food?"), so passing only id/name skipped rating entirely.
export function checkInTarget(created) {
  return {
    id: created.id,
    name: created.name,
    region: created.region,
    lat: created.lat,
    lng: created.lng,
    categories: created.categories || [],
    topic: created.topic || null,
    images: created.images || [],
  };
}

export const addCustomLandmark = invalidating(_addCustomLandmark);

export const deleteCustomLandmark = invalidating(_deleteCustomLandmark);

export const updateCustomLandmark = invalidating(_updateCustomLandmark);

export const reportCustomLandmark = invalidating(_reportCustomLandmark);
