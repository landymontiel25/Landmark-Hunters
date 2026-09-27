import { doc, setDoc, deleteDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// Corrected pin positions live in Firestore, keyed by region/id, and are
// merged over the static src/data/landmarks.*.js coordinates at render time.
// This is what makes a drag-to-fix on the map permanent for everyone instead
// of a one-off local change.
function overrideDocId(region, id) {
  return `${region}__${id}`;
}

// merge: true -- this collection is also where Admin Mode's richer field
// edits (landmark_edits, below) can live once a landmark's position has
// ALSO been drag-fixed by someone; a plain overwrite here would wipe
// whichever of the two wrote second. Position stays open to any signed-in
// user (firestore.rules only restricts landmark_edits to the admin
// account), so this must never touch fields outside lat/lng/name.
export async function saveLandmarkPosition({ region, id, name, lat, lng, userId }) {
  await setDoc(
    doc(db, 'landmark_overrides', overrideDocId(region, id)),
    { region, id, name, lat, lng, updatedAt: serverTimestamp(), updatedBy: userId || null },
    { merge: true }
  );
}

// Returns { "regionId/landmarkId": { lat, lng } } for every saved override.
export async function getLandmarkOverrides() {
  if (!db) return {};
  const snap = await getDocs(collection(db, 'landmark_overrides'));
  const map = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    map[`${x.region}/${x.id}`] = { lat: x.lat, lng: x.lng };
  });
  return map;
}

// Admin Mode's live edits to a BUILT-IN (static catalog) landmark --
// name/category/summary/facts/free/typicalMinutes/images, merged over the
// static data at render time everywhere a landmark is shown, the same way
// a position override already is. Unlike a custom (Firestore-native)
// landmark, there's no underlying doc to update directly -- the static
// source file is still the base record, this is a patch on top of it.
// Admin-only server-side (firestore.rules), regardless of what this client
// code does.
const EDITABLE_FIELDS = ['name', 'categories', 'summary', 'facts', 'free', 'typicalMinutes', 'images'];

export async function saveLandmarkEdit({ region, id, fields, userId }) {
  const clean = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] !== undefined) clean[f] = fields[f];
  }
  await setDoc(
    doc(db, 'landmark_edits', overrideDocId(region, id)),
    { region, id, ...clean, updatedAt: serverTimestamp(), updatedBy: userId || null },
    { merge: true }
  );
}

// Reverts a built-in landmark back to its original static data.
export async function clearLandmarkEdit(region, id) {
  await deleteDoc(doc(db, 'landmark_edits', overrideDocId(region, id)));
}

// Returns { "regionId/landmarkId": { name?, categories?, ... } } for every
// built-in landmark with a live admin edit.
export async function getLandmarkEdits() {
  if (!db) return {};
  const snap = await getDocs(collection(db, 'landmark_edits'));
  const map = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    const fields = {};
    for (const f of EDITABLE_FIELDS) {
      if (x[f] !== undefined) fields[f] = x[f];
    }
    map[`${x.region}/${x.id}`] = fields;
  });
  return map;
}
