import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { findUserByUsername, sendFriendRequest, acceptRequest, declineRequest, listFriends } from '../lib/friends';
import { listBlockedUsers, unblockUser } from '../lib/blocks';
import FriendStatsModal from './FriendStatsModal';
import ErrorNotice from './ErrorNotice';
import { SkeletonList } from './Skeleton';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState } from '../lib/usePersistentState';

export default function FriendsPanel() {
  const { user } = useAuth();
  const { requests, reload, myUsername, setUsername } = useFriends();
  const toast = useToast();
  // A half-typed friend handle survives leaving Profile (per account, 1 day).
  const [handle, setHandle] = usePersistentState(user ? `friendSearch.${user.uid}` : null, '', {
    ttlMs: 24 * 60 * 60 * 1000,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [friends, setFriends] = useState(null); // null = not loaded yet
  const [friendsError, setFriendsError] = useState(null);
  const friendsLoadedRef = useRef(false);
  const [blocked, setBlocked] = useState([]);
  // Requests just accepted/declined here disappear before the round trip.
  const [answeredIds, setAnsweredIds] = useState(() => new Set());
  const [unameInput, setUnameInput] = useState('');
  const [unameBusy, setUnameBusy] = useState(false);
  const [unameMsg, setUnameMsg] = useState(null);
  // { uid, name } | null -- which friend's stats popup is open, if any.
  const [openFriend, setOpenFriend] = useState(null);

  const loadFriends = async () => {
    try {
      setFriends(await listFriends(user.uid));
      friendsLoadedRef.current = true;
      setFriendsError(null);
    } catch (err) {
      // Only an error if there's nothing to show -- a failed refresh keeps
      // the list already on screen.
      if (!friendsLoadedRef.current) setFriendsError(err);
    }
  };

  const loadBlocked = async () => {
    try {
      setBlocked(await listBlockedUsers(user.uid));
    } catch {
      /* rules not set yet */
    }
  };

  useEffect(() => {
    loadFriends();
    loadBlocked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, requests.length, myUsername]);

  const handleUnblock = (b) =>
    runOptimistic({
      apply: () => setBlocked((cur) => cur.filter((x) => x.blockedUid !== b.blockedUid)),
      commit: async () => {
        await unblockUser(user.uid, b.blockedUid);
        await loadBlocked();
      },
      rollback: () => setBlocked((cur) => (cur.some((x) => x.blockedUid === b.blockedUid) ? cur : [...cur, b])),
      toast,
      errorMessage: friendlyError(null, `Couldn't unblock ${b.blockedName || 'that user'}. They're still blocked.`),
      retry: () => handleUnblock(b),
    });

  // Pre-fill the box with your current username so you can see/edit it.
  useEffect(() => {
    if (myUsername) setUnameInput(myUsername);
  }, [myUsername]);

  const handleSetUsername = async () => {
    setUnameMsg(null);
    setUnameBusy(true);
    try {
      const u = await setUsername(unameInput);
      setUnameMsg(`Username set to @${u}.`);
      setUnameInput(u);
    } catch (e) {
      setUnameMsg(friendlyError(e, "Couldn't set that username. Try again."));
    } finally {
      setUnameBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!handle.trim() || busy) return;
    setMsg(null);
    setBusy(true);
    const typed = handle;
    let found;
    try {
      // The lookup has to finish first (it decides whether there's anyone
      // to send to); the send itself is optimistic below.
      found = await findUserByUsername(typed);
    } catch (e) {
      setMsg(friendlyError(e, "Couldn't look up that username. Try again."));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!found) {
      setMsg('No user with that username.');
      return;
    }
    setMsg(`Friend request sent to @${found.username}.`);
    setHandle('');
    try {
      await sendFriendRequest(
        { uid: user.uid, username: myUsername, displayName: user.displayName, email: user.email },
        found
      );
    } catch (e) {
      // Put the handle back (unless they've started typing another) and say why.
      setHandle((cur) => cur || typed);
      setMsg(null);
      toast.show(friendlyError(e, `Couldn't send the request to @${found.username}.`), {
        actionLabel: 'Retry',
        onAction: handleAdd,
      });
    }
  };

  const markAnswered = (id, on) =>
    setAnsweredIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleAccept = (r) => {
    const edge = { friend: r.from, friendName: r.fromName };
    runOptimistic({
      apply: () => {
        markAnswered(r.id, true);
        setFriends((cur) => (cur && !cur.some((f) => f.friend === r.from) ? [...cur, edge] : cur));
      },
      commit: async () => {
        await acceptRequest(r);
        await reload();
        await loadFriends();
      },
      rollback: () => {
        markAnswered(r.id, false);
        setFriends((cur) => cur && cur.filter((f) => f !== edge));
      },
      toast,
      errorMessage: friendlyError(null, `Couldn't accept @${r.fromName}'s request, so it's back.`),
      retry: () => handleAccept(r),
    });
  };
  const handleDecline = (r) =>
    runOptimistic({
      apply: () => markAnswered(r.id, true),
      commit: async () => {
        await declineRequest(r);
        await reload();
      },
      rollback: () => markAnswered(r.id, false),
      toast,
      errorMessage: friendlyError(null, `Couldn't decline @${r.fromName}'s request, so it's back.`),
      retry: () => handleDecline(r),
    });

  const visibleRequests = requests.filter((r) => !answeredIds.has(r.id));

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F465}'} Friends</h3>

      {/* Username — always visible and editable (pre-filled with your current one) */}
      <div style={{ marginBottom: 16 }}>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          {myUsername ? (
            <>
              Your username is <strong>@{myUsername}</strong>. Change it below if you like.
            </>
          ) : (
            'Pick a username so friends can find you — no need to share your email.'
          )}
        </p>
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!unameBusy && unameInput.trim() && unameInput.trim().toLowerCase() !== (myUsername || '')) {
              handleSetUsername();
            }
          }}
        >
          <input
            className="friend-email-input"
            name="username"
            type="text"
            aria-label="Your username"
            placeholder="username"
            value={unameInput}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            enterKeyHint="done"
            onChange={(e) => setUnameInput(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={unameBusy || !unameInput.trim() || unameInput.trim().toLowerCase() === (myUsername || '')}
          >
            {unameBusy ? '…' : myUsername ? 'Update' : 'Save'}
          </button>
        </form>
        <p style={{ fontSize: '0.72rem', color: 'var(--color-parchment-dim)', margin: '6px 0 0' }}>
          3–20 characters: lowercase letters, numbers, or _
        </p>
        {unameMsg && (
          <p className="screen-subtitle" style={{ marginTop: 6, marginBottom: 0 }}>
            {unameMsg}
          </p>
        )}
      </div>

      {/* Add friends — only once you have a username */}
      {myUsername && (
        <div>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Add friends by their username.
          </p>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
          >
            <input
              className="friend-email-input"
              name="friend-username"
              type="search"
              aria-label="Friend's username"
              placeholder="@username"
              value={handle}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              enterKeyHint="send"
              onChange={(e) => setHandle(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !handle}>
              Add
            </button>
          </form>
          {msg && (
            <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
              {msg}
            </p>
          )}
        </div>
      )}

      {visibleRequests.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4 style={{ margin: '0 0 8px' }}>Requests</h4>
          {visibleRequests.map((r) => (
            <div key={r.id} className="friend-row">
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>@{r.fromName}</span>
              <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn btn-primary btn-tight" onClick={() => handleAccept(r)}>
                  Accept
                </button>
                <button type="button" className="btn btn-ghost btn-tight" onClick={() => handleDecline(r)}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <h4 style={{ margin: '0 0 8px' }}>Your friends{friends ? ` (${friends.length})` : ''}</h4>
        {friends === null && friendsError ? (
          <ErrorNotice
            compact
            message={friendlyError(friendsError, "We couldn't load your friends. Try again.")}
            onRetry={() => {
              setFriendsError(null);
              loadFriends();
            }}
          />
        ) : friends === null ? (
          <SkeletonList count={3} label="Loading your friends" />
        ) : friends.length === 0 ? (
          <p className="screen-subtitle" style={{ margin: 0 }}>No friends yet.</p>
        ) : (
          friends.map((f) => (
            <div
              key={f.friend}
              className="friend-row"
              style={{ cursor: 'pointer' }}
              onClick={() => setOpenFriend({ uid: f.friend, name: f.friendName })}
            >
              <span style={{ fontWeight: 700 }}>@{f.friendName}</span>
              <span style={{ color: 'var(--color-parchment-dim)' }}>{'›'}</span>
            </div>
          ))
        )}
      </div>

      {blocked.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4 style={{ margin: '0 0 8px' }}>Blocked ({blocked.length})</h4>
          {blocked.map((b) => (
            <div key={b.blockedUid} className="friend-row">
              <span>{b.blockedName || 'A user'}</span>
              <button type="button" className="btn btn-ghost btn-tight" onClick={() => handleUnblock(b)}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}

      {openFriend && (
        <FriendStatsModal uid={openFriend.uid} name={openFriend.name} onClose={() => setOpenFriend(null)} />
      )}

    </div>
  );
}
