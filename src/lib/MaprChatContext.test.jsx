// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// An in-memory stand-in for Firestore's mapr_chats: saves go into `docs`
// and every change is pushed to the live subscriber, like onSnapshot.
const h = vi.hoisted(() => ({ docs: new Map(), push: () => {}, tick: 0 }));
const docs = h.docs;
const emit = () => h.push([...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt));
const store = vi.hoisted(() => ({}));
Object.assign(store, {
  newId: () => `c${++h.tick}`,
  titleFrom: (t) => t.slice(0, 48),
  subscribeMyChats: (uid, onData) => {
    h.push = onData;
    emit();
    return () => {};
  },
  subscribeMyProjects: (uid, onData) => {
    onData([]);
    return () => {};
  },
  saveChat: vi.fn(async (uid, chat) => {
    docs.set(chat.id, { id: chat.id, ownerUid: uid, memberUids: [uid], projectId: null, title: chat.title, messages: chat.messages, regionIds: chat.regionIds, rev: chat.rev, updatedBy: uid, updatedAt: Date.now() + ++h.tick });
    emit();
  }),
  saveChatMessages: vi.fn(async (uid, id, { messages, regionIds, rev, title }) => {
    const cur = docs.get(id);
    docs.set(id, { ...cur, messages, regionIds, rev, ...(title ? { title } : {}), updatedBy: uid, updatedAt: Date.now() + ++h.tick });
    emit();
  }),
  renameChat: vi.fn(async (id, title) => {
    docs.set(id, { ...docs.get(id), title });
    emit();
  }),
  deleteChat: vi.fn(async (id) => {
    docs.delete(id);
    emit();
  }),
});
vi.mock('./maprChats', () => store);
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('./FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));

import { MaprChatProvider, useMaprChat } from './MaprChatContext';

let ctx;
function Probe() {
  ctx = useMaprChat();
  return null;
}
let root;
let el;
const wait = (ms = 600) => act(async () => new Promise((r) => setTimeout(r, ms)));

beforeEach(async () => {
  docs.clear();
  localStorage.clear();
  vi.clearAllMocks();
  el = document.createElement('div');
  root = createRoot(el);
  await act(async () =>
    root.render(
      <MaprChatProvider>
        <Probe />
      </MaprChatProvider>
    )
  );
});
afterEach(() => act(() => root.unmount()));

const say = (text) => act(() => ctx.setMessages((cur) => [...cur, { role: 'user', text }]));

describe('Mapr chats', () => {
  it("doesn't create a chat until you say something, then names it after your first message", async () => {
    await wait();
    expect(store.saveChat).not.toHaveBeenCalled();
    await say('Tacos near Villanova tonight');
    await wait();
    expect(store.saveChat).toHaveBeenCalledTimes(1);
    expect(ctx.chats).toHaveLength(1);
    expect(ctx.activeChat.title).toBe('Tacos near Villanova tonight');
  });

  it('keeps separate threads per chat and switches between them', async () => {
    await say('First chat question');
    await wait();
    const first = ctx.activeChat.id;
    await act(() => ctx.newChat());
    expect(ctx.messages).toHaveLength(1);
    await say('Second chat question');
    await wait();
    expect(ctx.chats).toHaveLength(2);
    await act(() => ctx.openChat(first));
    expect(ctx.messages.at(-1).text).toBe('First chat question');
  });

  it('lands a late reply in the chat it was asked in, not the one on screen', async () => {
    await say('Where should I eat?');
    await wait();
    const asked = ctx.activeChat.id;
    await act(() => ctx.newChat());
    await act(() => ctx.setMessagesFor(asked, (cur) => [...cur, { role: 'assistant', text: 'Try Dunkin' }]));
    await wait(50);
    expect(ctx.messages).toHaveLength(1);
    expect(docs.get(asked).messages.at(-1).text).toBe('Try Dunkin');
  });

  it("keeps a chat's typing indicator when a reply finishes in another chat", async () => {
    await say('Question in A');
    await wait();
    const a = ctx.activeChat.id;
    await act(() => ctx.setBusy(true)); // A's reply in flight
    await act(() => ctx.newChat());
    await act(() => ctx.setBusy(true, ctx.activeChat.id)); // B's reply in flight too
    await act(() => ctx.setBusy(false, a)); // A's reply lands
    expect(ctx.busy).toBe(true); // B is still waiting
    await act(() => ctx.openChat(a));
    expect(ctx.busy).toBe(false);
  });

  it("lands a reply even when you left the chat before its first message was saved", async () => {
    await say('Quick question');
    const asked = ctx.activeChat.id;
    await act(() => ctx.newChat()); // switched away inside the 500ms save delay
    await act(() => ctx.setMessagesFor(asked, (cur) => [...cur, { role: 'assistant', text: 'Late answer' }]));
    await wait();
    expect(docs.get(asked)?.messages.map((m) => m.text)).toEqual([expect.any(String), 'Quick question', 'Late answer']);
  });

  it('renames a chat, and a later message keeps the new name', async () => {
    await say('Paris plans');
    await wait();
    await act(() => ctx.renameChat(ctx.activeChat.id, 'Europe trip'));
    await say('More about Paris');
    await wait();
    expect(ctx.activeChat.title).toBe('Europe trip');
    expect(docs.get(ctx.activeChat.id).title).toBe('Europe trip');
  });

  it("picks up a friend's newer turn in a shared chat", async () => {
    await say('Plan our Rome day');
    await wait();
    const id = ctx.activeChat.id;
    const cur = docs.get(id);
    await act(async () => {
      docs.set(id, { ...cur, messages: [...cur.messages, { role: 'user', text: 'Add gelato' }], rev: cur.rev + 5, updatedBy: 'friend', updatedAt: Date.now() + ++h.tick });
      emit();
    });
    expect(ctx.messages.at(-1).text).toBe('Add gelato');
  });

  it('keeps drafts per chat', async () => {
    await act(() => ctx.setDraft('half-typed idea'));
    await say('go');
    await wait();
    await act(() => ctx.newChat());
    expect(ctx.draft).toBe('');
  });

  it('deleting the open chat starts a fresh one', async () => {
    await say('Delete me');
    await wait();
    await act(() => ctx.deleteChat(ctx.activeChat.id));
    await wait(50);
    expect(ctx.chats).toHaveLength(0);
    expect(ctx.messages).toHaveLength(1);
  });

  it('offers a retry for a question left unanswered for a while', async () => {
    await act(async () => {
      docs.set('old', { id: 'old', ownerUid: 'me', memberUids: ['me'], projectId: null, title: 'Old', messages: [{ role: 'user', text: 'Hello?' }], regionIds: [], rev: 1, updatedBy: 'me', updatedAt: Date.now() - 10 * 60 * 1000 });
      emit();
    });
    await act(() => ctx.openChat('old'));
    expect(ctx.messages.at(-1).retryText).toBe('Hello?');
  });

  it("never rolls back a turn that landed while this device's own save echoed back", async () => {
    await say('Question one');
    await wait();
    const id = ctx.activeChat.id;
    // This save's snapshot arrives right away, but the write itself hasn't
    // finished when the reply lands.
    let finish;
    store.saveChatMessages.mockImplementationOnce(async (uid, chatId, { messages, regionIds, rev }) => {
      docs.set(chatId, { ...docs.get(chatId), messages, regionIds, rev, updatedBy: uid, updatedAt: Date.now() });
      emit();
      await new Promise((r) => (finish = r));
    });
    await say('Question two');
    await wait();
    await act(() => ctx.setMessages((cur) => [...cur, { role: 'assistant', text: 'Answer two' }]));
    await act(async () => emit()); // the server confirms the older save
    expect(ctx.messages.at(-1).text).toBe('Answer two');
    await act(async () => finish());
    await wait();
    expect(docs.get(id).messages.at(-1).text).toBe('Answer two');
  });
});
