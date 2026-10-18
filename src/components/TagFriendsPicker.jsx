import { useEffect, useRef, useState } from 'react';
import { listFriends } from '../lib/friends';

// The rating form's "@ Tag a friend" button (owner, 2026-10-18): tap it for
// a dropdown of your friends; each one you tap is tagged (a chip, and
// "@name" in your comment) and gets a notification once the rating saves
// (reviews.js). `uid`: the signed-in rater; hidden without one.
export default function TagFriendsPicker({ uid, tagged = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState(null); // null = not loaded yet
  const [failed, setFailed] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open || !uid || friends) return undefined;
    let cancelled = false;
    listFriends(uid)
      .then((list) => !cancelled && setFriends(list.map((f) => ({ uid: f.friend, name: f.friendName || 'friend' }))))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, uid, friends]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!uid) return null;
  const taggedIds = new Set(tagged.map((t) => t.uid));
  const choices = (friends || []).filter((f) => !taggedIds.has(f.uid));

  return (
    <div className="tag-friends" ref={boxRef}>
      <div className="tag-friends-row">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          @ Tag a friend
        </button>
        {tagged.map((t) => (
          <span key={t.uid} className="tag tag-friend-chip">
            @{t.name}
            <button type="button" aria-label={`Untag @${t.name}`} onClick={() => onChange(tagged.filter((x) => x.uid !== t.uid), { removed: t })}>
              {'×'}
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="tag-friends-menu" role="listbox" aria-label="Your friends">
          {failed ? (
            <div className="tag-friends-empty">Couldn't load your friends. Try again in a moment.</div>
          ) : friends === null ? (
            <div className="tag-friends-empty">Loading your friends…</div>
          ) : !friends.length ? (
            <div className="tag-friends-empty">No friends yet. Add someone by their username on Profile.</div>
          ) : !choices.length ? (
            <div className="tag-friends-empty">You tagged all your friends.</div>
          ) : (
            choices.map((f) => (
              <button
                key={f.uid}
                type="button"
                role="option"
                aria-selected="false"
                className="tag-friends-option"
                onClick={() => {
                  onChange([...tagged, f], { added: f });
                  setOpen(false);
                }}
              >
                @{f.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
