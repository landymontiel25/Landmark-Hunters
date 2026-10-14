import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { getUserProfile, sendFriendRequest, hasPendingRequestTo } from '../lib/friends';
import FriendStatsModal from './FriendStatsModal';
import FollowButton from './FollowButton';
import { Skeleton } from './Skeleton';
import { useToast } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { HOVER_CLICK_GRACE_MS, mouseOnly } from '../lib/mouseOnly';

// Wraps a name (leaderboard, full-list page, wherever) so tapping it goes
// straight to that person's stats if you're already friends -- the same
// popup as tapping their name in the Friends list -- or, for someone you're
// not friends with yet, hovering (desktop) or tapping (mobile) pops open a
// small card with their @username and a one-tap way to friend them.
export default function FriendPopoverName({ userId, fallbackName, children }) {
  const { user } = useAuth();
  const { friendUids, myUsername } = useFriends();
  const [open, setOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState(null); // null | 'sent'
  const toast = useToast();
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const hoverOpenedAt = useRef(0);

  const isMe = user && userId === user.uid;
  const isFriend = friendUids.has(userId);

  // Hover with a grace period for a mouse, tap to toggle on a phone. Hover
  // listens to the mouse only (mouseOnly): a tap's own enter event opened
  // the card and the tap's click closed it again.
  // Only relevant for the small "add friend" card below -- a friend's name
  // opens their stats modal directly instead, so it never needs a hover.
  const openNow = () => {
    if (isFriend) return;
    clearTimeout(closeTimer.current);
    if (!open) hoverOpenedAt.current = Date.now();
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const handleActivate = () => {
    if (isFriend && !isMe) {
      setShowStats(true);
      return;
    }
    if (open && Date.now() - hoverOpenedAt.current < HOVER_CLICK_GRACE_MS) return;
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (open && !profile && userId) {
      getUserProfile(userId)
        .then((p) => setProfile(p || {}))
        .catch(() => setProfile({ loadFailed: true }));
    }
  }, [open, userId, profile]);

  // The popover unmounts on close and re-mounts fresh on the next open, so
  // without this a request you already sent looks forgotten every time you
  // reopen it -- check for a pending request each time it opens and show
  // "Sent" immediately instead of "Add Friend" again.
  useEffect(() => {
    if (!open || !user || !userId || isMe) return;
    let cancelled = false;
    hasPendingRequestTo(user.uid, userId)
      .then((sent) => {
        if (!cancelled && sent) setStatus('sent');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, user, userId, isMe]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Optimistic: "Sent" right away; if the write fails it flips back to
  // "Add Friend" and a toast says why, with Retry.
  const addFriend = async () => {
    if (!user || !profile?.uid) return;
    const target = profile;
    setStatus('sent');
    try {
      await sendFriendRequest(
        { uid: user.uid, username: myUsername, displayName: user.displayName, email: user.email },
        target
      );
    } catch (e) {
      setStatus(null);
      toast.show(friendlyError(e, `Couldn't send a friend request to @${target.username || fallbackName}.`), {
        actionLabel: 'Retry',
        onAction: addFriend,
      });
    }
  };

  return (
    <span className="user-popover" ref={ref} onPointerEnter={mouseOnly(openNow)} onPointerLeave={mouseOnly(closeSoon)}>
      <span
        className="user-popover-trigger"
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate();
          }
        }}
      >
        {children}
      </span>
      {open && !isFriend && (
        <div className="user-popover-card" onClick={(e) => e.stopPropagation()}>
          <div className="user-popover-username">@{profile?.username || fallbackName}</div>
          {!isMe && profile?.uid && !profile.loadFailed && (
            <div style={{ margin: '4px 0 6px' }}>
              <FollowButton uid={userId} profile={profile} compact />
            </div>
          )}
          {!isMe && !profile && (
            <span role="status" aria-live="polite">
              <span className="visually-hidden">Loading profile…</span>
              <Skeleton width={96} height={26} radius={999} />
            </span>
          )}
          {!isMe && profile?.loadFailed && (
            <p className="user-popover-note">
              {friendlyError(null, "Couldn't load their profile.")}{' '}
              <button type="button" className="btn btn-ghost btn-tight" onClick={() => setProfile(null)}>
                Try again
              </button>
            </p>
          )}
          {!isMe && profile && !profile.loadFailed && (
            <button type="button" className="btn btn-primary btn-tight" disabled={status === 'sent'} onClick={addFriend}>
              {status === 'sent' ? `${'\u{2713}'} Sent` : `${'\u{2795}'} Add Friend`}
            </button>
          )}
        </div>
      )}
      {showStats && (
        <FriendStatsModal uid={userId} name={profile?.username || fallbackName} onClose={() => setShowStats(false)} />
      )}
    </span>
  );
}
