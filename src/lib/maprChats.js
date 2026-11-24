import {
  doc,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { notifyUser } from './notifications';

// Mapr's chats and projects, synced per account (like Claude's sidebar).
//
// mapr_chats/{id}: { ownerUid, memberUids, projectId, title, messagesJson,
//   regionIds, rev, updatedBy, archivedUids, createdAt, updatedAt }
//
// Chats are permanent (owner, 2026-11-23): nobody deletes one, not from the
// app and not through the rules. Archive hides a chat from your list and
// can be undone; archivedUids holds who archived it, so in a shared project
// each person archives it only for themselves.
// mapr_projects/{id}: { ownerUid, memberUids, memberNames, name,
//   instructions, createdAt, updatedAt }
//
// A chat's memberUids always equals its project's memberUids (or just its
// owner when it's in no project) -- firestore.rules enforces that, so
// sharing a project shares every chat in it, and one array-contains query
// lists everything you can see. Messages are stored as one JSON string:
// Firestore rejects nested arrays and undefined values, and a chat's stop
// lists can carry both.

export const MAX_CHAT_MESSAGES = 60;
const MAX_JSON = 800_000;
const TITLE_MAX = 80;
export const INSTRUCTIONS_MAX = 4000;

export const newId = () => doc(collection(db, 'mapr_chats')).id;

export function encodeMessages(messages) {
  let list = (messages || []).slice(-MAX_CHAT_MESSAGES);
  let json = JSON.stringify(list);
  while (json.length > MAX_JSON && list.length > 1) {
    list = list.slice(1);
    json = JSON.stringify(list);
  }
  return json;
}

export function decodeMessages(json) {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// First thing you asked, trimmed -- the same way a new Claude chat names itself.
export function titleFrom(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  return t.length > 48 ? `${t.slice(0, 47).trimEnd()}…` : t;
}

const cleanTitle = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'New chat';

function fromChatDoc(d) {
  const x = d.data();
  return {
    id: d.id,
    ownerUid: x.ownerUid,
    memberUids: x.memberUids || [],
    projectId: x.projectId || null,
    title: x.title || 'New chat',
    messages: decodeMessages(x.messagesJson),
    regionIds: Array.isArray(x.regionIds) ? x.regionIds : [],
    rev: x.rev || 0,
    updatedBy: x.updatedBy || null,
    archivedUids: Array.isArray(x.archivedUids) ? x.archivedUids : [],
    updatedAt: x.updatedAt?.toMillis?.() || Date.now(),
  };
}

function fromProjectDoc(d) {
  const x = d.data();
  return {
    id: d.id,
    ownerUid: x.ownerUid,
    memberUids: x.memberUids || [],
    memberNames: x.memberNames || {},
    name: x.name || 'Untitled project',
    instructions: x.instructions || '',
    updatedAt: x.updatedAt?.toMillis?.() || Date.now(),
  };
}

export function subscribeMyChats(uid, onData, onError) {
  const q = query(collection(db, 'mapr_chats'), where('memberUids', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(fromChatDoc).sort((a, b) => b.updatedAt - a.updatedAt)),
    (e) => onError?.(e)
  );
}

export function subscribeMyProjects(uid, onData, onError) {
  const q = query(collection(db, 'mapr_projects'), where('memberUids', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(fromProjectDoc).sort((a, b) => a.name.localeCompare(b.name))),
    (e) => onError?.(e)
  );
}

// Creates or overwrites a whole chat. memberUids comes from the project
// (or is just you), which the rules check.
export async function saveChat(uid, chat, project) {
  await setDoc(doc(db, 'mapr_chats', chat.id), {
    ownerUid: chat.ownerUid || uid,
    memberUids: project ? project.memberUids : [chat.ownerUid || uid],
    projectId: project ? project.id : null,
    title: cleanTitle(chat.title),
    messagesJson: encodeMessages(chat.messages),
    regionIds: chat.regionIds || [],
    rev: chat.rev || 0,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// The conversation itself -- any member of a shared project can add to it.
export async function saveChatMessages(uid, chatId, { messages, regionIds, rev, title }) {
  await updateDoc(doc(db, 'mapr_chats', chatId), {
    messagesJson: encodeMessages(messages),
    regionIds: regionIds || [],
    rev,
    ...(title ? { title: cleanTitle(title) } : {}),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
}

export async function renameChat(chatId, title) {
  await updateDoc(doc(db, 'mapr_chats', chatId), { title: cleanTitle(title), updatedAt: serverTimestamp() });
}

// Archive or unarchive for this account only. updatedAt stays, so an
// unarchived chat goes back to where it was in the list.
export async function setChatArchived(chatId, uid, archived) {
  await updateDoc(doc(db, 'mapr_chats', chatId), { archivedUids: archived ? arrayUnion(uid) : arrayRemove(uid) });
}

// Moving a chat in or out of a project changes who can see it.
export async function moveChat(chat, project) {
  await updateDoc(doc(db, 'mapr_chats', chat.id), {
    projectId: project ? project.id : null,
    memberUids: project ? project.memberUids : [chat.ownerUid],
    updatedAt: serverTimestamp(),
  });
}

export async function createProject(uid, username, { name, instructions = '' }) {
  const ref = doc(collection(db, 'mapr_projects'));
  const project = {
    ownerUid: uid,
    memberUids: [uid],
    memberNames: { [uid]: username || 'You' },
    name: (name || '').trim().slice(0, TITLE_MAX) || 'Untitled project',
    instructions: (instructions || '').slice(0, INSTRUCTIONS_MAX),
  };
  await setDoc(ref, { ...project, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { id: ref.id, ...project };
}

export async function updateProject(projectId, { name, instructions }) {
  await updateDoc(doc(db, 'mapr_projects', projectId), {
    ...(name !== undefined ? { name: name.trim().slice(0, TITLE_MAX) || 'Untitled project' } : {}),
    ...(instructions !== undefined ? { instructions: instructions.slice(0, INSTRUCTIONS_MAX) } : {}),
    updatedAt: serverTimestamp(),
  });
}

async function chatsInProject(projectId, uid) {
  // Filtered here rather than with a second where(), which would need a
  // composite index.
  const snap = await getDocs(query(collection(db, 'mapr_chats'), where('memberUids', 'array-contains', uid)));
  return snap.docs.map(fromChatDoc).filter((c) => c.projectId === projectId);
}

// Owner only. Adds people: the project first, then every chat in it, so
// each chat's members keep matching the project's (the rules require it).
export async function shareProject(owner, project, people) {
  const add = people.filter((p) => !project.memberUids.includes(p.uid));
  if (!add.length) return project;
  const memberUids = [...project.memberUids, ...add.map((p) => p.uid)];
  const memberNames = { ...project.memberNames, ...Object.fromEntries(add.map((p) => [p.uid, p.name])) };
  await updateDoc(doc(db, 'mapr_projects', project.id), { memberUids, memberNames, updatedAt: serverTimestamp() });
  const chats = await chatsInProject(project.id, owner.uid);
  const batch = writeBatch(db);
  chats.forEach((c) => batch.update(doc(db, 'mapr_chats', c.id), { memberUids }));
  await batch.commit();
  // One at a time: they share the sender's notice allowance (notifications.js).
  for (const p of add) {
    await notifyUser(p.uid, {
      type: 'mapr_project_invite',
      message: `\u{1F4C1} @${owner.name} shared the Mapr project "${project.name}" with you.`,
      maprProjectId: project.id,
    }).catch(() => {});
  }
  return { ...project, memberUids, memberNames };
}

// Owner only. Their own chats leave the project with them (back to private);
// everyone else's chats drop them from the member list.
export async function removeFromProject(ownerUid, project, uid) {
  if (uid === project.ownerUid) return project;
  const memberUids = project.memberUids.filter((m) => m !== uid);
  const memberNames = { ...project.memberNames };
  delete memberNames[uid];
  await updateDoc(doc(db, 'mapr_projects', project.id), { memberUids, memberNames, updatedAt: serverTimestamp() });
  const chats = await chatsInProject(project.id, ownerUid);
  const batch = writeBatch(db);
  chats.forEach((c) =>
    batch.update(
      doc(db, 'mapr_chats', c.id),
      c.ownerUid === uid ? { projectId: null, memberUids: [uid] } : { memberUids }
    )
  );
  await batch.commit();
  return { ...project, memberUids, memberNames };
}

// Owner only. Chats in it aren't deleted -- they go back to their owners
// as regular chats.
export async function deleteProject(ownerUid, project) {
  const chats = await chatsInProject(project.id, ownerUid);
  const batch = writeBatch(db);
  chats.forEach((c) => batch.update(doc(db, 'mapr_chats', c.id), { projectId: null, memberUids: [c.ownerUid] }));
  await batch.commit();
  await deleteDoc(doc(db, 'mapr_projects', project.id));
}
