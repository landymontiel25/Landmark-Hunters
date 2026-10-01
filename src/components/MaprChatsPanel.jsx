import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { useMaprChat } from '../lib/MaprChatContext';
import { useToast } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { matchesSearch } from '../lib/search';
import { INSTRUCTIONS_MAX } from '../lib/maprChats';
import AddMemberSheet from './AddMemberSheet';

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// One chat row: tap to open; ⋯ for rename / move / delete.
function ChatRow({ chat, active, projects, isMine, onOpen }) {
  const { renameChat, deleteChat, moveChat } = useMaprChat();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Escape') return;
        e.preventDefault(); // close just the menu, not the panel around it
        setMenu(false);
      } else if (!rowRef.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const run = async (fn, fail) => {
    setMenu(false);
    try {
      await fn();
    } catch (e) {
      toast.show(friendlyError(e, fail), { tone: 'error' });
    }
  };

  if (renaming) {
    return (
      <form
        className="mapr-chat-row editing"
        onSubmit={(e) => {
          e.preventDefault();
          setRenaming(false);
          run(() => renameChat(chat.id, title), "Couldn't rename that chat.");
        }}
      >
        <input
          autoFocus
          aria-label="Chat name"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => e.currentTarget.form.requestSubmit()}
        />
      </form>
    );
  }

  return (
    <div className={`mapr-chat-row ${active ? 'active' : ''}`} ref={rowRef}>
      <button type="button" className="mapr-chat-open" onClick={() => onOpen(chat.id)}>
        <span className="mapr-chat-title">{chat.title}</span>
        <span className="mapr-chat-when">{chat.updatedAt ? ago(chat.updatedAt) : 'not sent yet'}</span>
      </button>
      <button type="button" className="mapr-chat-more" aria-label={`Options for ${chat.title}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {'\u{22EF}'}
      </button>
      {menu && (
        <div className="mapr-chat-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setTitle(chat.title); setRenaming(true); }}>
            {'\u{270F}\u{FE0F}'} Rename
          </button>
          {isMine &&
            projects
              .filter((p) => p.id !== chat.projectId)
              .map((p) => (
                <button key={p.id} type="button" role="menuitem" onClick={() => run(() => moveChat(chat.id, p.id), "Couldn't move that chat.")}>
                  {'\u{1F4C1}'} Move to {p.name}
                </button>
              ))}
          {isMine && chat.projectId && (
            <button type="button" role="menuitem" onClick={() => run(() => moveChat(chat.id, null), "Couldn't move that chat.")}>
              {'\u{21A9}\u{FE0F}'} Remove from project
            </button>
          )}
          {isMine && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                if (window.confirm(`Delete "${chat.title}"? This can't be undone.`)) run(() => deleteChat(chat.id), "Couldn't delete that chat.");
                else setMenu(false);
              }}
            >
              {'\u{1F5D1}\u{FE0F}'} Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Create or edit a project: name, instructions Mapr follows in every chat
// in it, and (owner) who it's shared with.
export function ProjectEditor({ project, onClose }) {
  const { user } = useAuth();
  const { createProject, updateProject, shareProject, removeFromProject, deleteProject, newChat } = useMaprChat();
  const toast = useToast();
  const [name, setName] = useState(project?.name || '');
  const [instructions, setInstructions] = useState(project?.instructions || '');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [current, setCurrent] = useState(project);
  const isOwner = !current || current.ownerUid === user?.uid;

  const save = async () => {
    setSaving(true);
    try {
      if (current) {
        await updateProject(current.id, { name, instructions });
        onClose();
      } else {
        const created = await createProject({ name, instructions });
        newChat(created.id);
        onClose(true);
      }
    } catch (e) {
      toast.show(friendlyError(e, "Couldn't save that project."), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          {'\u{1F4C1}'} {current ? 'Project' : 'New project'}
        </h3>
        <div className="field">
          <label htmlFor="mapr-project-name">Name</label>
          <input id="mapr-project-name" type="text" value={name} maxLength={80} placeholder="Europe summer trip" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mapr-project-instr">Instructions for Mapr</label>
          <textarea
            id="mapr-project-instr"
            className="rating-comment"
            style={{ width: '100%', minHeight: 90 }}
            maxLength={INSTRUCTIONS_MAX}
            placeholder="10 cities in 3 weeks, mid-range budget, we love food markets and hate long museum days."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <p className="screen-subtitle" style={{ margin: '4px 0 0', fontSize: '0.78rem' }}>
            Mapr follows these in every chat in this project.
          </p>
        </div>

        {current && (
          <div className="field">
            <label>Shared with</label>
            {current.memberUids.map((m) => (
              <div key={m} className="friend-row">
                <span>
                  @{current.memberNames?.[m] || 'member'}
                  {m === current.ownerUid ? ' (owner)' : ''}
                  {m === user?.uid ? ' · you' : ''}
                </span>
                {isOwner && m !== current.ownerUid && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-tight"
                    onClick={async () => {
                      try {
                        setCurrent(await removeFromProject(current, m));
                      } catch (e) {
                        toast.show(friendlyError(e, "Couldn't remove them."), { tone: 'error' });
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {isOwner && (
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setSharing(true)}>
                {'\u{1F465}'} Share with a friend
              </button>
            )}
          </div>
        )}

        <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : current ? 'Save' : 'Create project'}
        </button>
        {current && isOwner && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginTop: 8, color: 'var(--danger)' }}
            onClick={async () => {
              if (!window.confirm(`Delete "${current.name}"? Its chats stay, as regular chats.`)) return;
              try {
                await deleteProject(current);
                onClose();
              } catch (e) {
                toast.show(friendlyError(e, "Couldn't delete that project."), { tone: 'error' });
              }
            }}
          >
            {'\u{1F5D1}\u{FE0F}'} Delete project
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => onClose()}>
          Cancel
        </button>
      </div>
      {sharing && current && (
        <AddMemberSheet
          title={`Share "${current.name}"`}
          excludeUids={current.memberUids}
          alreadyText="They're already in this project."
          onPick={async (person) => {
            try {
              setCurrent(await shareProject(current, [person]));
              toast.show(`Shared with @${person.name}.`, { tone: 'success' });
            } catch (e) {
              toast.show(friendlyError(e, "Couldn't share the project."), { tone: 'error' });
            }
          }}
          onClose={() => setSharing(false)}
        />
      )}
    </div>,
    document.body
  );
}

// The chat list: search, new chat, projects (each with its chats), and your
// other chats -- the same shape as Claude's sidebar.
export default function MaprChatsPanel({ onClose }) {
  const { user } = useAuth();
  const { chats, projects, activeChat, openChat, newChat, syncError } = useMaprChat();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // project object, or 'new'
  const [openProjects, setOpenProjects] = useState(() => new Set(activeChat.projectId ? [activeChat.projectId] : []));

  const hits = (c) => matchesSearch(`${c.title} ${c.messages.map((m) => m.text).join(' ')}`, q);
  const shown = q.trim() ? chats.filter(hits) : chats;
  const loose = shown.filter((c) => !c.projectId || !projects.some((p) => p.id === c.projectId));
  const pick = (id) => {
    openChat(id);
    onClose();
  };
  const toggleProject = (id) =>
    setOpenProjects((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return createPortal(
    <div className="modal-backdrop mapr-chats-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mapr-chats-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Your Mapr chats">
        <div className="mapr-chats-head">
          <h3>{'\u{1F4AC}'} Chats</h3>
          <button type="button" className="btn btn-ghost btn-tight" onClick={onClose} aria-label="Close">
            {'\u{2715}'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ flex: 1 }}
            onClick={() => {
              newChat(null);
              onClose();
            }}
          >
            {'\u{2795}'} New chat
          </button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setEditing('new')}>
            {'\u{1F4C1}'} New project
          </button>
        </div>
        <input
          type="search"
          className="itin-search"
          aria-label="Search chats"
          placeholder={'\u{1F50D} Search chats'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {syncError && (
          <p className="screen-subtitle" style={{ color: 'var(--danger)' }}>
            {friendlyError(syncError, "Couldn't sync your chats. They're safe on this device for now.")}
          </p>
        )}

        {projects.length > 0 && <div className="mapr-chats-section">Projects</div>}
        {projects.map((p) => {
          const inside = shown.filter((c) => c.projectId === p.id);
          if (q.trim() && !inside.length && !matchesSearch(p.name, q)) return null;
          const open = openProjects.has(p.id) || !!q.trim();
          const sharedCount = p.memberUids.length - 1;
          return (
            <div key={p.id} className="mapr-project">
              <div className="mapr-project-head">
                <button type="button" className="mapr-project-toggle" aria-expanded={open} onClick={() => toggleProject(p.id)}>
                  <span>{open ? '\u{25BE}' : '\u{25B8}'}</span> {'\u{1F4C1}'} {p.name}
                  <span className="mapr-chat-when">
                    {inside.length} chat{inside.length !== 1 ? 's' : ''}
                    {sharedCount > 0 ? ` · shared with ${sharedCount}` : ''}
                  </span>
                </button>
                <button type="button" className="mapr-chat-more" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                  {'\u{2699}\u{FE0F}'}
                </button>
              </div>
              {open && (
                <div className="mapr-project-chats">
                  <button
                    type="button"
                    className="mapr-chat-new-in"
                    onClick={() => {
                      newChat(p.id);
                      onClose();
                    }}
                  >
                    {'\u{2795}'} New chat in {p.name}
                  </button>
                  {inside.map((c) => (
                    <ChatRow key={c.id} chat={c} active={c.id === activeChat.id} projects={projects} isMine={c.ownerUid === user?.uid} onOpen={pick} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="mapr-chats-section">{projects.length ? 'Other chats' : 'Your chats'}</div>
        {loose.length === 0 && (
          <p className="screen-subtitle" style={{ margin: '4px 0' }}>
            {q.trim() ? 'No chats match.' : 'Nothing yet. Say something to Mapr and your chat shows up here.'}
          </p>
        )}
        {loose.map((c) => (
          <ChatRow key={c.id} chat={c} active={c.id === activeChat.id} projects={projects} isMine={c.ownerUid === user?.uid} onOpen={pick} />
        ))}
      </div>
      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          onClose={(createdNew) => {
            setEditing(null);
            if (createdNew) onClose();
          }}
        />
      )}
    </div>,
    document.body
  );
}
