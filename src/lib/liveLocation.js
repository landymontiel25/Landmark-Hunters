import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { readPersisted, writePersisted } from './usePersistentState';

// Live location on a group trip, like WhatsApp's: a member shares where they
// are with everyone on the trip, for a while they choose, and can stop any
// time. One doc per sharer: group_trips/{tripId}/live_locations/{uid}
// { uid, name, lat, lng, accuracy, mode, expiresAt (ms), updatedAt }.
// Only trip members can read them; only you can write or delete your own
// (firestore.rules). A doc past its expiresAt is hidden from everyone.

export const LIVE_SHARE_OPTIONS = [
  { id: 'viewing', label: "Only while I'm on this trip's page" },
  { id: '15m', label: '15 minutes', ms: 15 * 60 * 1000 },
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '8h', label: '8 hours', ms: 8 * 60 * 60 * 1000 },
];
// "While on this page" is a heartbeat: each write keeps it alive this long,
// so closing the app or losing signal drops you off within two minutes.
export const VIEWING_HEARTBEAT_MS = 2 * 60 * 1000;
// Write again after moving this far, or after this long regardless.
export const MOVE_METERS = 25;
export const REFRESH_MS = 45 * 1000;

// When a share chosen now ends (ms). Viewing shares are renewed per write.
export function shareUntil(optionId, now = Date.now()) {
  const opt = LIVE_SHARE_OPTIONS.find((o) => o.id === optionId);
  if (!opt) return null;
  return opt.ms ? now + opt.ms : now + VIEWING_HEARTBEAT_MS;
}

const meters = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Whether to write a new position: the first one, after moving MOVE_METERS,
// or once REFRESH_MS has passed (which also renews a viewing heartbeat).
export function shouldPush(last, coords, now = Date.now()) {
  if (!coords) return false;
  if (!last) return true;
  return now - last.at >= REFRESH_MS || meters(last, coords) >= MOVE_METERS;
}

// The sharers to show: not expired, newest first.
export function visibleSharers(docs, now = Date.now()) {
  return (docs || [])
    .filter((d) => d && Number.isFinite(d.lat) && Number.isFinite(d.lng) && Number(d.expiresAt) > now)
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
}

// ---- Firestore ----------------------------------------------------------------

const ref = (tripId, uid) => doc(db, 'group_trips', tripId, 'live_locations', uid);

export async function pushLiveLocation({ tripId, uid, name, coords, mode, expiresAt }) {
  if (!db || !tripId || !uid || !coords) return;
  await setDoc(ref(tripId, uid), {
    uid,
    name: String(name || 'A traveler').slice(0, 60),
    lat: coords.lat,
    lng: coords.lng,
    accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
    mode: mode === 'viewing' ? 'viewing' : 'timed',
    expiresAt: Math.round(expiresAt),
    updatedAt: serverTimestamp(),
  });
}

export async function stopLiveLocation(tripId, uid) {
  if (!db || !tripId || !uid) return;
  await deleteDoc(ref(tripId, uid));
}

export function subscribeLiveLocations(tripId, onData, onError = () => {}) {
  if (!db || !tripId) return () => {};
  return onSnapshot(
    collection(db, 'group_trips', tripId, 'live_locations'),
    (snap) =>
      onData(
        snap.docs.map((d) => {
          const x = d.data();
          return { ...x, updatedAtMs: x.updatedAt?.toMillis ? x.updatedAt.toMillis() : Date.now() };
        })
      ),
    onError
  );
}

// ---- This device's own shares ---------------------------------------------------
// { [tripId]: { mode: 'viewing' | 'timed', until, name } }, so a timed share
// keeps updating from anywhere in the app (LiveLocationSharer) until it ends.
const KEY = 'liveShares';
export const readShares = () => readPersisted(KEY) || {};
export function writeShares(next) {
  writePersisted(KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lh-live-shares'));
}
