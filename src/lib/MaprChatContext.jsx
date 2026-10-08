import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { getRegion } from '../data/regions';
import { clearPersisted, readPersisted, writePersisted } from './usePersistentState';
import * as store from './maprChats';

const MaprChatContext = createContext(null);

export const MAPR_GREETING =
  "Hey — I'm Mapr. Tell me what you're up for: a vibe, a time budget, an interest, whatever. I'll line up real stops.";

// Shown in place of a reply that never came back because the app was closed
// (or reloaded) while it was still in flight -- the saved thread ends on the
// traveler's own message, so offer to resend it instead of leaving it
// hanging with no answer.
const INTERRUPTED_REPLY = "That reply didn't finish before the app closed. Want me to try again?";

const initialMessages = () => [{ role: 'assistant', text: MAPR_GREETING, stops: [] }];

// The open chat is also kept on this device, so Mapr paints it instantly on
// launch (and works offline) before the synced copy arrives.
const MAX_STORED_MESSAGES = 40;
const LOCAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const storageKey = (uid) => `mapr.chat.${uid}`;
const STALE_TURN_MS = 2 * 60 * 1000;
const draftsKey = (uid) => `mapr.drafts.${uid}`;

const newChatId = () => {
  try {
    return store.newId();
  } catch {
    return `local-${Date.now()}`;
  }
};

const freshChat = (uid, projectId = null) => ({
  uid,
  id: newChatId(),
  ownerUid: uid,
  projectId,
  title: 'New chat',
  renamed: false,
  messages: initialMessages(),
  regionIds: [],
  showPlanner: false,
  rev: 0,
  saved: false,
  restored: false,
});

const withInterruptedNote = (messages) => {
  const last = messages.at(-1);
  if (last?.role !== 'user') return messages;
  // requestFor rides along so Try again on a group plan stays a group plan
  // (a solo resend would send the traveler's own taste).
  return [...messages, { role: 'assistant', text: INTERRUPTED_REPLY, stops: [], error: true, retryText: last.text, ...(last.requestFor ? { requestFor: last.requestFor } : {}) }];
};

// Signed-out chats aren't saved: the AI needs an account anyway, and a
// shared device shouldn't carry an anonymous thread into the next session.
// A thread saved before multiple chats existed has no id; it gets one and
// becomes your first synced chat on its next save.
function loadChat(uid) {
  if (!uid) return freshChat(uid);
  const saved = readPersisted(storageKey(uid), LOCAL_TTL_MS);
  if (!saved || !Array.isArray(saved.messages) || !saved.messages.length) return freshChat(uid);
  const messages = withInterruptedNote(saved.messages);
  return {
    ...freshChat(uid, saved.projectId || null),
    id: saved.id || newChatId(),
    ownerUid: saved.ownerUid || uid,
    title: saved.title || 'New chat',
    renamed: !!saved.renamed,
    messages,
    regionIds: Array.isArray(saved.regionIds) ? saved.regionIds.filter((id) => getRegion(id)) : [],
    showPlanner: !!saved.showPlanner,
    rev: saved.rev || 0,
    saved: !!saved.saved,
    // Only worth a "picked up where you left off" note when there's an
    // actual conversation to come back to, not just the greeting.
    restored: messages.length > 1,
  };
}

const fromRemote = (uid, remote) => ({
  ...freshChat(uid, remote.projectId),
  id: remote.id,
  ownerUid: remote.ownerUid,
  title: remote.title,
  renamed: remote.title !== 'New chat',
  // A reply can still be on its way (from this device, or a friend asking
  // in a shared project); only call it interrupted once it's clearly stale.
  messages: !remote.messages.length
    ? initialMessages()
    : Date.now() - remote.updatedAt > STALE_TURN_MS
    ? withInterruptedNote(remote.messages)
    : remote.messages,
  regionIds: remote.regionIds.filter((id) => getRegion(id)),
  rev: remote.rev,
  saved: true,
});

const resolve = (update, cur) => (typeof update === 'function' ? update(cur) : update);
const firstUserText = (messages) => messages.find((m) => m.role === 'user')?.text || '';

// Mapr's chats, like Claude's sidebar: any number of chats per account,
// each with its own thread and cities, renameable, optionally grouped into
// projects you can share with friends (src/lib/maprChats.js has the data
// model). The open chat's state lives here, above the router, so leaving
// Mapr for another tab and coming back keeps the conversation -- and a
// reply still in flight lands in the chat it belongs to even if you've
// switched to another one meanwhile (setMessagesFor).
export function MaprChatProvider({ children }) {
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const uid = user?.uid ?? null;
  const synced = !!(firebaseEnabled && uid);
  const [chat, setChat] = useState(() => loadChat(uid));
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [totalCost, setTotalCost] = useState(0);
  // The chat a reply is in flight for, if any. Never saved: nothing is in
  // flight after a relaunch.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [drafts, setDrafts] = useState(() => (uid ? readPersisted(draftsKey(uid)) || {} : {}));
  const uidRef = useRef(uid);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // Latest in-memory copy of every chat opened this session, so a reply that
  // lands after you switched away builds on what you actually sent (the saved
  // copy can be up to a save-delay behind, or not exist yet for a new chat).
  const snapshotsRef = useRef({});
  // Chats deleted here or elsewhere: a late reply must not re-create them.
  const deletedIdsRef = useRef(new Set());
  snapshotsRef.current[chat.id] = chat;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const lastSavedRef = useRef('');

  useEffect(() => {
    if (uidRef.current === uid) return;
    uidRef.current = uid;
    setChat(loadChat(uid));
    setChats([]);
    setProjects([]);
    setListLoaded(false);
    setDrafts(uid ? readPersisted(draftsKey(uid)) || {} : {});
    setTotalCost(0);
    setBusyIds(new Set());
  }, [uid]);

  // Live lists of every chat and project you can see (yours and shared).
  useEffect(() => {
    if (!synced) return undefined;
    setSyncError(null);
    const offChats = store.subscribeMyChats(
      uid,
      (list) => {
        setChats(list);
        setListLoaded(true);
      },
      setSyncError
    );
    const offProjects = store.subscribeMyProjects(uid, setProjects, () => {});
    return () => {
      offChats();
      offProjects();
    };
  }, [synced, uid]);

  // A chat that shows up in the synced list again (re-shared into a project)
  // is live: let it save.
  useEffect(() => {
    for (const c of chats) deletedIdsRef.current.delete(c.id);
  }, [chats]);

  // Keep the open chat in step with its synced copy: a newer turn from a
  // friend in a shared project, or a rename/move from another device.
  useEffect(() => {
    const remote = chats.find((c) => c.id === chat.id);
    if (!remote) {
      // Deleted elsewhere (or you were removed from its project).
      if (chat.saved && listLoaded) {
        deletedIdsRef.current.add(chat.id);
        delete snapshotsRef.current[chat.id];
        setChat(freshChat(uid));
      }
      return;
    }
    setChat((c) => {
      if (c.id !== remote.id) return c;
      const meta = { title: remote.title, renamed: c.renamed || remote.title !== 'New chat', projectId: remote.projectId, ownerUid: remote.ownerUid, saved: true };
      if (remote.rev > c.rev && !busyIds.has(c.id)) {
        const next = fromRemote(uid, remote);
        lastSavedRef.current = JSON.stringify([next.messages, next.regionIds]);
        return { ...next, showPlanner: c.showPlanner };
      }
      const changed = Object.keys(meta).some((k) => c[k] !== meta[k]);
      return changed ? { ...c, ...meta } : c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, listLoaded]);

  // Save: the open chat to this device right away, and to Firestore a beat
  // later. A chat that's still only the greeting isn't created anywhere --
  // like Claude, a new chat exists once you've said something.
  useEffect(() => {
    if (!chat.uid || chat.uid !== uid) return undefined;
    const t = setTimeout(() => {
      const empty = chat.messages.length <= 1 && !chat.regionIds.length && !chat.showPlanner;
      if (empty && !chat.saved) clearPersisted(storageKey(chat.uid));
      else
        writePersisted(storageKey(chat.uid), {
          id: chat.id,
          ownerUid: chat.ownerUid,
          projectId: chat.projectId,
          title: chat.title,
          renamed: chat.renamed,
          messages: chat.messages.slice(-MAX_STORED_MESSAGES),
          regionIds: chat.regionIds,
          showPlanner: chat.showPlanner,
          rev: chat.rev,
          saved: chat.saved,
        });
      if (!synced || chat.messages.length <= 1) return;
      const sig = JSON.stringify([chat.messages, chat.regionIds]);
      if (sig === lastSavedRef.current && chat.saved) return;
      lastSavedRef.current = sig;
      const remoteRev = chatsRef.current.find((c) => c.id === chat.id)?.rev || 0;
      const rev = Math.max(chat.rev, remoteRev) + 1;
      const title = chat.renamed ? chat.title : store.titleFrom(firstUserText(chat.messages));
      const project = chat.projectId ? projectsRef.current.find((p) => p.id === chat.projectId) : null;
      // A chat started inside a project waits for the project list rather
      // than being created outside it.
      if (chat.projectId && !project && !chat.saved) {
        lastSavedRef.current = '';
        return;
      }
      const write = chat.saved
        ? store.saveChatMessages(uid, chat.id, { messages: chat.messages, regionIds: chat.regionIds, rev, title: chat.renamed ? null : title })
        : store.saveChat(uid, { ...chat, title, rev }, project);
      write
        .then(() => {
          setSyncError(null);
          setChat((c) => (c.id === chat.id ? { ...c, rev: Math.max(c.rev, rev), saved: true, title: c.renamed ? c.title : title } : c));
        })
        .catch((e) => {
          lastSavedRef.current = '';
          setSyncError(e);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [chat, uid, synced]);

  useEffect(() => {
    if (!uid) return;
    writePersisted(draftsKey(uid), drafts);
  }, [drafts, uid]);

  const setMessages = useCallback((u) => setChat((c) => ({ ...c, messages: resolve(u, c.messages) })), []);

  // Writes to a specific chat whether or not it's the one on screen -- a
  // reply that finishes after you switched chats still lands where you
  // asked it.
  const setMessagesFor = useCallback(
    (chatId, u) => {
      if (chatRef.current.id === chatId) {
        setMessages(u);
        return;
      }
      if (!synced || deletedIdsRef.current.has(chatId)) return;
      const remote = chatsRef.current.find((c) => c.id === chatId);
      const snap = snapshotsRef.current[chatId];
      // The snapshot is at least as new as the saved copy unless someone else
      // (a friend in a shared project) added turns since.
      const base = snap && (!remote || snap.messages.length >= remote.messages.length) ? snap.messages : remote?.messages;
      if (!base) return;
      const messages = resolve(u, base);
      if (snap) snapshotsRef.current[chatId] = { ...snap, messages };
      if (remote) {
        store
          .saveChatMessages(uid, chatId, { messages, regionIds: remote.regionIds, rev: Math.max(remote.rev, snap?.rev || 0) + 1 })
          .catch(setSyncError);
      } else if (snap && messages.length > 1) {
        const project = snap.projectId ? projectsRef.current.find((p) => p.id === snap.projectId) : null;
        const title = snap.renamed ? snap.title : store.titleFrom(firstUserText(messages));
        store.saveChat(uid, { ...snap, messages, title, rev: (snap.rev || 0) + 1 }, project).catch(setSyncError);
      }
    },
    [setMessages, synced, uid]
  );

  const draft = drafts[chat.id] || '';
  const setDraft = useCallback(
    (u) => {
      const id = chatRef.current.id;
      setDrafts((d) => {
        const next = resolve(u, d[id] || '');
        const copy = { ...d };
        if (next) copy[id] = next;
        else delete copy[id];
        return copy;
      });
    },
    []
  );
  const setShowPlanner = useCallback((u) => setChat((c) => ({ ...c, showPlanner: resolve(u, c.showPlanner) })), []);
  // Stored as ids (full region objects carry every landmark), handed out as
  // the same region objects MultiRegionSearch works with.
  const regions = useMemo(() => chat.regionIds.map(getRegion).filter(Boolean), [chat.regionIds]);
  const setRegions = useCallback(
    (u) =>
      setChat((c) => {
        const cur = c.regionIds.map(getRegion).filter(Boolean);
        return { ...c, regionIds: resolve(u, cur).map((r) => r.id) };
      }),
    []
  );
  const dismissRestored = useCallback(() => setChat((c) => ({ ...c, restored: false })), []);
  // "Discard" on the restored-conversation note: start a new chat. The old
  // one stays in your chat list.
  const discardChat = useCallback(() => setChat((c) => freshChat(c.uid, c.projectId)), []);

  const newChat = useCallback((projectId = null) => {
    lastSavedRef.current = '';
    setChat(freshChat(uidRef.current, projectId));
  }, []);

  const openChat = useCallback(
    (id) => {
      if (chatRef.current.id === id) return;
      const remote = chatsRef.current.find((c) => c.id === id);
      if (!remote) return;
      const next = fromRemote(uid, remote);
      lastSavedRef.current = JSON.stringify([next.messages, next.regionIds]);
      setChat(next);
    },
    [uid]
  );

  const renameChat = useCallback(async (id, title) => {
    if (chatRef.current.id === id) setChat((c) => ({ ...c, title: title.trim() || 'New chat', renamed: true }));
    if (chatsRef.current.some((c) => c.id === id)) await store.renameChat(id, title);
  }, []);

  const deleteChat = useCallback(
    async (id) => {
      deletedIdsRef.current.add(id);
      const snap = snapshotsRef.current[id];
      delete snapshotsRef.current[id];
      try {
        if (chatsRef.current.some((c) => c.id === id)) await store.deleteChat(id);
      } catch (e) {
        // Not deleted after all: let it save again.
        deletedIdsRef.current.delete(id);
        if (snap) snapshotsRef.current[id] = snap;
        throw e;
      }
      if (chatRef.current.id === id) {
        clearPersisted(storageKey(uid));
        setChat(freshChat(uid));
      }
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[id];
        return copy;
      });
    },
    [uid]
  );

  const moveChat = useCallback(async (id, projectId) => {
    const project = projectId ? projectsRef.current.find((p) => p.id === projectId) : null;
    if (chatRef.current.id === id) setChat((c) => ({ ...c, projectId: project ? project.id : null }));
    const remote = chatsRef.current.find((c) => c.id === id);
    if (remote) await store.moveChat(remote, project);
  }, []);

  const createProject = useCallback(
    (fields) => store.createProject(uid, myUsername, fields),
    [uid, myUsername]
  );
  const updateProject = useCallback((id, fields) => store.updateProject(id, fields), []);
  const shareProject = useCallback(
    (project, people) => store.shareProject({ uid, name: myUsername || 'A friend' }, project, people),
    [uid, myUsername]
  );
  const removeFromProject = useCallback((project, memberUid) => store.removeFromProject(uid, project, memberUid), [uid]);
  const deleteProject = useCallback(async (project) => {
    await store.deleteProject(uid, project);
    if (chatRef.current.projectId === project.id) setChat((c) => ({ ...c, projectId: null }));
  }, [uid]);

  const activeProject = chat.projectId ? projects.find((p) => p.id === chat.projectId) || null : null;
  // Each chat tracks its own in-flight reply: finishing one chat's reply
  // must not clear another chat's typing indicator (or let you double-send).
  const setBusy = useCallback((on, id = chatRef.current.id) => {
    setBusyIds((cur) => {
      if (cur.has(id) === !!on) return cur;
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <MaprChatContext.Provider
      value={{
        messages: chat.messages,
        setMessages,
        setMessagesFor,
        draft,
        setDraft,
        regions,
        setRegions,
        showPlanner: chat.showPlanner,
        setShowPlanner,
        totalCost,
        setTotalCost,
        busy: busyIds.has(chat.id),
        setBusy,
        restored: chat.restored,
        dismissRestored,
        discardChat,
        // Multiple chats and projects
        synced,
        syncError,
        activeChat: { id: chat.id, title: chat.title, projectId: chat.projectId, ownerUid: chat.ownerUid, saved: chat.saved },
        activeProject,
        chats,
        projects,
        newChat,
        openChat,
        renameChat,
        deleteChat,
        moveChat,
        createProject,
        updateProject,
        shareProject,
        removeFromProject,
        deleteProject,
      }}
    >
      {children}
    </MaprChatContext.Provider>
  );
}

export function useMaprChat() {
  const ctx = useContext(MaprChatContext);
  if (!ctx) throw new Error('useMaprChat must be used inside MaprChatProvider');
  return ctx;
}
