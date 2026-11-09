import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { goBack } from '../lib/goBack';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { getUserProfile } from '../lib/friends';
import { getUserStats, getUserCheckins, getFriendsLeaderboard } from '../lib/leaderboard';
import { blockUser, listBlockedUsers } from '../lib/blocks';
import { getFriendSoloStreak, removeFriend } from '../lib/friendProfileApi';
import { readPersisted } from '../lib/usePersistentState';
import { MISSING, joinedText, levelText, countriesOf, countText, friendStanding, lastCheckin, soloStreakDays } from '../lib/friendProfile';
import { useConfirm } from '../components/ConfirmSheet';
import { useToast } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonCard } from '../components/Skeleton';

// A friend's full profile, opened from "See full profile" in the friend
// popup (components/FriendStatsModal.jsx). Owner, 2026-11-06: these fields
// and nothing else -- header (name, @username, joined, trainer level),
// points with their rank among your friends, check-in / city / country
// counts, the solo streak if they have one, the last check-in as text, then
// Remove friend and Block. No badges, pair streaks, map, pins, home area,
// email or settings. A private profile shows only the header and a note.
// A missing value shows "–" and its row stays.

// The leaderboard period the Profile and Full Leaderboard tabs are on, so
// this page's points are the number those screens show.
const PERIOD_KEY = 'leaderboard.period';
const PERIOD_LABEL = { weekly: 'this week', monthly: 'this month', yearly: 'this year' };
const periodNow = () => {
  const p = readPersisted(PERIOD_KEY);
  return PERIOD_LABEL[p] ? p : 'weekly';
};

function Row({ label, value }) {
  return (
    <div className="fp-row">
      <span className="fp-row-label">{label}</span>
      <span className="fp-row-value">{value}</span>
    </div>
  );
}

export default function FriendProfile() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { friendUids, friendsKnown, reload } = useFriends();
  const toast = useToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  const period = periodNow();
  const myUid = user?.uid || null;
  const isFriend = friendUids.has(uid);
  // The effect keys on the ids, not the Set (a new Set every reload would
  // refetch the whole page).
  const friendKey = [...friendUids].sort().join(',');

  useEffect(() => {
    if (!myUid || !friendsKnown) return undefined;
    let cancelled = false;
    const done = (s) => !cancelled && setState(s);
    (async () => {
      // Blocked users never get this page, either way round: your own
      // blocks are listed; one from them shows as the server's "unavailable".
      const blocked = await listBlockedUsers(myUid).catch(() => []);
      if (uid === myUid || !isFriend || blocked.some((b) => b.blockedUid === uid)) return done({ unavailable: true });
      const profile = await getUserProfile(uid).catch(() => null);
      if (!profile) return done({ unavailable: true });
      const isPrivate = profile.public !== true;
      // Lifetime points for the level, the same as the popup and Full Stats.
      const statsP = getUserStats(uid).catch(() => null);
      if (isPrivate) return done({ profile, isPrivate, stats: await statsP });
      const [stats, checkins, board, streak] = await Promise.all([
        statsP,
        getUserCheckins(uid).catch(() => null),
        getFriendsLeaderboard(period, friendKey ? friendKey.split(',') : [], myUid).catch(() => null),
        getFriendSoloStreak(uid).catch((e) => (e?.code === 'unavailable' ? 'unavailable' : null)),
      ]);
      if (streak === 'unavailable') return done({ unavailable: true });
      done({ profile, isPrivate, stats, checkins, board, soloStreak: streak?.soloStreak || null });
    })();
    return () => {
      cancelled = true;
    };
  }, [myUid, uid, friendsKnown, isFriend, friendKey, period]);

  const back = () => goBack(navigate, location, '/profile');
  const name = state.profile?.username ? `@${state.profile.username}` : 'this friend';

  const onRemove = async () => {
    if (!(await confirm({ title: `Remove ${name}?`, body: "You'll stop seeing each other's friends-only check-ins. You can send a new friend request later.", confirmLabel: 'Remove friend' }))) return;
    setBusy(true);
    try {
      await removeFriend(uid);
      await reload().catch(() => {});
      toast.show(`Removed ${name} from your friends.`, { tone: 'info' });
      navigate('/profile', { replace: true });
    } catch (e) {
      setBusy(false);
      toast.show(friendlyError(e, `Couldn't remove ${name}. Try again.`));
    }
  };

  const onBlock = async () => {
    if (!(await confirm({ title: `Block ${name}?`, body: ["They won't be able to see your reviews or send you friend requests, and this ends your friendship.", 'You can unblock them from Profile.'], confirmLabel: 'Block' }))) return;
    setBusy(true);
    try {
      await blockUser(myUid, uid, state.profile?.username || null);
      // A block ends the friendship too; best effort, the block alone already
      // hides them both ways.
      await removeFriend(uid).catch(() => {});
      await reload().catch(() => {});
      toast.show(`Blocked ${name}.`, { tone: 'info' });
      navigate('/profile', { replace: true });
    } catch (e) {
      setBusy(false);
      toast.show(friendlyError(e, `Couldn't block ${name}. Try again.`));
    }
  };

  const backButton = (
    <button type="button" className="btn btn-ghost btn-block back-sticky" style={{ marginBottom: 24 }} onClick={back}>
      {'\u{2190}'} Back
    </button>
  );

  if (!user) {
    return (
      <div>
        {backButton}
        <p className="screen-subtitle">Sign in on Profile to see your friends.</p>
      </div>
    );
  }
  if (state.unavailable) {
    return (
      <div>
        {backButton}
        <p className="screen-subtitle">This profile isn't available.</p>
      </div>
    );
  }
  if (state.loading) {
    return (
      <div role="status" aria-live="polite">
        {backButton}
        <span className="visually-hidden">Loading their profile…</span>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
      </div>
    );
  }

  const { profile, isPrivate, stats } = state;
  const standing = friendStanding(state.board, uid);
  const last = lastCheckin(state.checkins);
  const streakDays = soloStreakDays(state.soloStreak);

  return (
    <div className="friend-profile">
      {backButton}

      {/* 1. Header */}
      <div className="card section">
        <h1 className="screen-title" style={{ margin: 0 }}>
          {profile.displayName || MISSING}
        </h1>
        <p className="screen-subtitle" style={{ margin: '2px 0 12px' }}>
          {profile.username ? `@${profile.username}` : MISSING}
        </p>
        <Row label="Joined" value={joinedText(profile.createdAt)} />
        <Row label="Trainer level" value={levelText(stats)} />
      </div>

      {isPrivate ? (
        <div className="card section">
          <p className="screen-subtitle" style={{ margin: 0 }}>
            {'\u{1F512}'} Private profile
          </p>
        </div>
      ) : (
        <>
          {/* The headline numbers first: points, check-ins and cities (owner,
              2026-11-09); the rows below stay as they were. */}
          <div className="profile-stats fp-stat-tiles">
            <div className="profile-stat">
              <span className="profile-stat-num">{standing.points === MISSING ? MISSING : Number(standing.points).toLocaleString()}</span>
              <span className="profile-stat-label">pts {PERIOD_LABEL[period]}</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-num">{countText(stats?.checkins)}</span>
              <span className="profile-stat-label">check-ins</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-num">{countText(stats?.cities)}</span>
              <span className="profile-stat-label">cities</span>
            </div>
          </div>

          {/* 2. Points, from the leaderboard */}
          <div className="card section">
            <Row label={`Points (${PERIOD_LABEL[period]})`} value={standing.points === MISSING ? MISSING : `${standing.points} pts`} />
            <Row label="Rank among your friends" value={standing.rank} />
          </div>

          {/* 3. Counts, 4. solo streak */}
          <div className="card section">
            <Row label="Check-ins" value={countText(stats?.checkins)} />
            <Row label="Cities" value={countText(stats?.cities)} />
            <Row label="Countries" value={countText(countriesOf(stats?.cityIds))} />
            {streakDays > 0 && <Row label="Solo streak" value={`\u{1F525} ${streakDays} ${streakDays === 1 ? 'day' : 'days'}`} />}
          </div>

          {/* 5. Last check-in, text only */}
          <div className="card section">
            <h3 style={{ marginTop: 0 }}>Last check-in</h3>
            <Row label="Landmark" value={last.name} />
            <Row label="City" value={last.city} />
            <Row label="Date" value={last.date} />
          </div>
        </>
      )}

      {/* 6. Actions */}
      <div className="fp-actions">
        <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onRemove}>
          Remove friend
        </button>
        <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={onBlock}>
          Block
        </button>
      </div>
      {confirmNode}
    </div>
  );
}
