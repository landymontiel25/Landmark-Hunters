import { doc, setDoc, updateDoc, deleteDoc, collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

// Favorite places (owner, 2026-10-28): places you want to find again, kept
// with a short note of your own ("great pizza, ask for the garlic knots"),
// in any city or country. One doc per place at users/{uid}/favorites/
// {region}__{landmarkId}, readable and writable only by you, so it follows
// you across devices and reinstalls.
export const FAVORITE_NOTE_MAX = 500;

export const favoriteId = (region, id) => (region && id ? `${region}__${id}` : null);

const clean = (note) => String(note || '').slice(0, FAVORITE_NOTE_MAX);

export async function addFavorite(uid, { region, id, name, lat, lng, note = '' }) {
  const key = favoriteId(region, id);
  if (!db || !uid || !key) throw new Error('Could not save that place.');
  await setDoc(doc(db, 'users', uid, 'favorites', key), {
    region: String(region),
    id: String(id),
    name: String(name || '').slice(0, 200),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    note: clean(note),
    savedAt: Date.now(),
  });
}

export async function setFavoriteNote(uid, region, id, note) {
  const key = favoriteId(region, id);
  if (!db || !uid || !key) return;
  await updateDoc(doc(db, 'users', uid, 'favorites', key), { note: clean(note) });
}

export async function removeFavorite(uid, region, id) {
  const key = favoriteId(region, id);
  if (!db || !uid || !key) return;
  await deleteDoc(doc(db, 'users', uid, 'favorites', key));
}

/** Live list, newest first. Returns the unsubscribe function. */
export function subscribeFavorites(uid, onRows, onError) {
  if (!db || !uid) {
    onRows([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'users', uid, 'favorites'),
    (snap) => onRows(snap.docs.map((d) => d.data()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))),
    (e) => onError?.(e)
  );
}
