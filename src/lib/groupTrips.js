import {
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from './firebase';
import { notifyUser } from './notifications';

// firestore.rules caps memberUids at 25 (owner included).
export const MAX_GROUP_MEMBERS = 25;
function fullError() {
  const e = new Error(`A group trip can have up to ${MAX_GROUP_MEMBERS} people, including you.`);
  e.userMessage = e.message;
  return e;
}

// A trip a few friends build together (item i6): one shared landmark list,
// visible and editable by every member. Any member can rename it, edit the
// shared lists and invite people; only the owner can remove members (see
// firestore.rules).
//
// initialMembers ({ uid, name }[]) lets the owner invite friends in the same
// write that creates the trip -- e.g. from Trip Setup's friend picker --
// instead of creating an owner-only trip and then calling addGroupMember in
// a loop right after.
export async function createGroupTrip({ ownerUid, ownerName, name, regionId, landmarkIds = [], places = [], initialMembers = [] }) {
  if (1 + initialMembers.length > MAX_GROUP_MEMBERS) throw fullError();
  const ref = await addDoc(collection(db, 'group_trips'), {
    ownerUid,
    name,
    regionId,
    memberUids: [ownerUid, ...initialMembers.map((m) => m.uid)],
    memberNames: {
      [ownerUid]: ownerName,
      ...Object.fromEntries(initialMembers.map((m) => [m.uid, m.name])),
    },
    landmarkIds,
    places,
    createdAt: serverTimestamp(),
  });
  // Let each invited friend know right away -- best-effort, since a
  // notification failing to write should never undo a successful invite.
  await Promise.all(
    initialMembers.map((m) =>
      notifyUser(m.uid, {
        type: 'group_invite',
        message: `\u{1F465} ${ownerName || 'A friend'} added you to a group trip: ${name}`,
        groupTripId: ref.id,
      }).catch(() => {})
    )
  );
  return ref.id;
}

// onData(null) = no such trip. onError gets the Firestore error -- note a
// trip you're not a member of (or one that was deleted) reads back as
// permission-denied, since the rules can't tell those two apart for you.
export function subscribeGroupTrip(tripId, onData, onError) {
  if (!db) {
    onData(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'group_trips', tripId),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => onError?.(err)
  );
}

export async function listMyGroupTrips(uid) {
  if (!db || !uid) return [];
  const snap = await getDocs(query(collection(db, 'group_trips'), where('memberUids', 'array-contains', uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// `add` says which way to flip it (defaults to the opposite of what `trip`
// shows). arrayUnion/arrayRemove rather than writing the whole list, so two
// members ticking different landmarks at once don't overwrite each other,
// and a retry after a failure can't undo someone else's change.
export async function toggleGroupLandmark(trip, landmarkId, add = !(trip.landmarkIds || []).includes(landmarkId)) {
  await updateDoc(doc(db, 'group_trips', trip.id), {
    landmarkIds: add ? arrayUnion(landmarkId) : arrayRemove(landmarkId),
  });
}

// Select all / clear all in one write -- same arrayUnion/arrayRemove
// reasoning as the single toggle above.
export async function setGroupLandmarks(trip, landmarkIds, add) {
  if (!landmarkIds.length) return;
  await updateDoc(doc(db, 'group_trips', trip.id), {
    landmarkIds: add ? arrayUnion(...landmarkIds) : arrayRemove(...landmarkIds),
  });
}

// A drag reorder (see useDragReorder.js) needs the whole new order written
// at once, unlike the toggle/select-all above -- arrayUnion/arrayRemove
// only add or drop entries, they can't rearrange the ones already there.
// Two members dragging at the same moment can race and one write wins;
// acceptable here since a reorder is a personal convenience, not data
// that must never be lost the way a landmark selection is.
export async function reorderGroupLandmarks(trip, orderedIds) {
  await updateDoc(doc(db, 'group_trips', trip.id), { landmarkIds: orderedIds });
}

export async function addGroupMember(trip, memberUid, memberName) {
  if ((trip.memberUids || []).includes(memberUid)) return;
  if ((trip.memberUids || []).length >= MAX_GROUP_MEMBERS) throw fullError();
  await updateDoc(doc(db, 'group_trips', trip.id), {
    memberUids: arrayUnion(memberUid),
    [`memberNames.${memberUid}`]: memberName,
  });
  notifyUser(memberUid, {
    type: 'group_invite',
    message: `\u{1F465} You were added to a group trip: ${trip.name}`,
    groupTripId: trip.id,
  }).catch(() => {});
}

export async function removeGroupMember(trip, memberUid) {
  const memberNames = { ...trip.memberNames };
  delete memberNames[memberUid];
  await updateDoc(doc(db, 'group_trips', trip.id), {
    memberUids: (trip.memberUids || []).filter((u) => u !== memberUid),
    memberNames,
    name: trip.name,
  });
}

export async function deleteGroupTrip(tripId) {
  await deleteDoc(doc(db, 'group_trips', tripId));
}

export async function renameGroupTrip(trip, name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean || clean === trip.name) return;
  await updateDoc(doc(db, 'group_trips', trip.id), { name: clean });
}

// Real places Mapr found on the web (not in the catalog), shared with the
// whole trip. place: { id, name, address, lat, lng, url }
export async function addGroupPlace(trip, place) {
  if ((trip.places || []).some((p) => p.id === place.id)) return;
  await updateDoc(doc(db, 'group_trips', trip.id), { places: arrayUnion(place) });
}

export async function removeGroupPlace(trip, placeId) {
  const place = (trip.places || []).find((p) => p.id === placeId);
  if (!place) return;
  await updateDoc(doc(db, 'group_trips', trip.id), { places: arrayRemove(place) });
}
