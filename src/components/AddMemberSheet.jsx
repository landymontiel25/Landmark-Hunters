import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { findUserByUsername, listFriends } from '../lib/friends';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';
import { SkeletonList } from './Skeleton';

// "Add a user" for an itinerary: search anyone by username, or tap one of
// your friends. onPick({ uid, name }) does the actual adding.
export default function AddMemberSheet({
  title = 'Add someone',
  excludeUids = [],
  alreadyText = "They're already on this itinerary.",
  onPick,
  onClose,
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle'); // idle | searching | notfound | error
  const [error, setError] = useState(null);
  const [friends, setFriends] = useState(null);
  const [friendsError, setFriendsError] = useState(null);
  // A friend being added right now: a second tap must not send a second
  // invite (the row only leaves once the trip snapshot comes back).
  const [pendingUid, setPendingUid] = useState(null);
  const pickFriend = async (f) => {
    if (pendingUid === f.friend) return;
    setPendingUid(f.friend);
    try {
      await onPick({ uid: f.friend, name: f.friendName });
    } finally {
      setPendingUid((cur) => (cur === f.friend ? null : cur));
    }
  };

  const loadFriends = () => {
    if (!user) return;
    setFriendsError(null);
    listFriends(user.uid)
      .then(setFriends)
      .catch((e) => {
        setFriends([]);
        setFriendsError(e);
      });
  };
  useEffect(loadFriends, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (e) => {
    e?.preventDefault();
    const name = query.trim().replace(/^@/, '');
    if (!name) return;
    setStatus('searching');
    setError(null);
    try {
      const found = await findUserByUsername(name);
      if (!found?.uid) {
        setStatus('notfound');
        return;
      }
      if (found.uid === user?.uid || excludeUids.includes(found.uid)) {
        setStatus('notfound');
        setError(found.uid === user?.uid ? "That's you." : alreadyText);
        return;
      }
      setStatus('idle');
      onPick({ uid: found.uid, name: found.username || found.displayName || name });
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  };

  const available = (friends || []).filter((f) => !excludeUids.includes(f.friend));

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          {'\u{2795}'} {title}
        </h3>
        <form onSubmit={search} className="field" style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            type="search"
            name="username"
            aria-label="Username"
            placeholder="Search by username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (status !== 'searching') setStatus('idle');
            }}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!query.trim() || status === 'searching'}>
            {status === 'searching' ? 'Looking…' : 'Add'}
          </button>
        </form>
        {status === 'notfound' && (
          <p className="screen-subtitle" style={{ marginTop: 8 }}>
            {typeof error === 'string' ? error : `No one goes by @${query.trim().replace(/^@/, '')}. Check the spelling.`}
          </p>
        )}
        {status === 'error' && <ErrorNotice error={error} onRetry={search} compact />}

        <p className="screen-subtitle" style={{ margin: '16px 0 6px' }}>
          Or pick a friend
        </p>
        {friends === null && <SkeletonList count={2} label="Loading friends" />}
        {friendsError && (
          <ErrorNotice error={friendsError} message={friendlyError(friendsError, "Couldn't load your friends.")} onRetry={loadFriends} compact />
        )}
        {friends !== null && !friendsError && available.length === 0 && (
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {friends.length ? 'All your friends are already on it.' : 'No friends yet — search by username above.'}
          </p>
        )}
        {available.map((f) => (
          <div key={f.friend} className="friend-row">
            <span>{f.friendName}</span>
            <button type="button" className="btn btn-ghost btn-tight" disabled={pendingUid === f.friend} onClick={() => pickFriend(f).catch(() => {})}>
              {'\u{2795}'} Add
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>,
    document.body
  );
}
