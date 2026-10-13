import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { getUserProfile } from '../lib/friends';
import { listMyFollowing } from '../lib/followsApi';
import FollowButton, { followerLabel } from './FollowButton';

// Your follows (Phase 2): your follower and following counts (kept by the
// server) and the people you follow, each with Following to unfollow.
export default function FollowsPanel() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const [people, setPeople] = useState(null);
  const [failed, setFailed] = useState(false);

  const myUid = user?.uid || null;
  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    listMyFollowing(myUid)
      .then((rows) => Promise.all(rows.map(async (r) => ({ ...r, profile: await getUserProfile(r.uid).catch(() => null) }))))
      .then((rows) => !cancelled && setPeople(rows.filter((r) => r.profile)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [myUid]);

  if (!user) return null;
  const followers = Math.max(0, Number(myProfile?.followerCount) || 0);
  const following = Math.max(0, Number(myProfile?.followingCount) || 0);
  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F465}'} Follows</h3>
      <p className="secondary" style={{ margin: '0 0 8px' }}>
        {followerLabel(followers)} · {following} following
      </p>
      {myProfile && myProfile.public !== true && (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          Your profile is private, so nobody can follow you. Make it public in Settings to let people follow your tips.
        </p>
      )}
      {failed && <p className="muted" style={{ fontSize: 13 }}>Couldn't load who you follow.</p>}
      {people?.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Follow people from their tips or their name on a leaderboard.</p>}
      {people?.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {people.map((p) => (
            <li key={p.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span>@{p.profile.username || p.profile.displayName || 'explorer'}</span>
              <FollowButton uid={p.uid} profile={p.profile} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
