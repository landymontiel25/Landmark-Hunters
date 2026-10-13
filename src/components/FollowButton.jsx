import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { getUserProfile } from '../lib/friends';
import { followUser, isFollowing, unfollowUser } from '../lib/followsApi';
import { useToast } from '../lib/ToastContext';

export const followerLabel = (n) => `${n} ${n === 1 ? 'follower' : 'followers'}`;

// Follow / Following for someone's public profile (Phase 2), with their
// follower count. Shows nothing for your own profile; a private profile
// shows its count only (it can't be followed). Pass `profile` when the
// caller already has users/{uid}; otherwise it's loaded here.
export default function FollowButton({ uid, profile: given = null, compact = false }) {
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState(given);
  const [following, setFollowing] = useState(null); // null = not known yet
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(null);
  const isMe = user?.uid === uid;

  useEffect(() => {
    if (given) {
      setProfile(given);
      return;
    }
    let cancelled = false;
    getUserProfile(uid)
      .then((p) => !cancelled && setProfile(p || {}))
      .catch(() => !cancelled && setProfile({}));
    return () => {
      cancelled = true;
    };
  }, [uid, given]);

  useEffect(() => {
    if (profile) setCount(Math.max(0, Number(profile.followerCount) || 0));
  }, [profile]);

  const myUid = user?.uid || null;
  useEffect(() => {
    if (!myUid || isMe || !uid) return;
    let cancelled = false;
    isFollowing(myUid, uid)
      .then((f) => !cancelled && setFollowing(f))
      .catch(() => !cancelled && setFollowing(false));
    return () => {
      cancelled = true;
    };
  }, [myUid, uid, isMe]);

  if (!profile || count == null) return null;
  // A profile that went private after you followed it can still be
  // unfollowed.
  const canFollow = !!user && !isMe && (profile.public === true || following === true);

  // Optimistic: flips right away, flips back with the server's reason if
  // it refuses.
  const toggle = async () => {
    if (busy || following == null) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      await (next ? followUser(uid) : unfollowUser(uid));
    } catch (e) {
      setFollowing(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast?.show?.(e?.userMessage || (next ? "Couldn't follow. Try again." : "Couldn't unfollow. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="follow-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className={compact ? 'muted' : 'secondary'} style={{ fontSize: compact ? 12 : 14 }}>
        {followerLabel(count)}
      </span>
      {canFollow && (
        <button
          type="button"
          className={following ? 'btn btn-ghost btn-tight' : 'btn btn-primary btn-tight'}
          disabled={busy || following == null}
          aria-pressed={!!following}
          onClick={toggle}
        >
          {following ? 'Following' : 'Follow'}
        </button>
      )}
    </span>
  );
}
