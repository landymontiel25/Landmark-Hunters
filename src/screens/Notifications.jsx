import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { acceptRequest, declineRequest } from '../lib/friends';
import { subscribeMyNotifications, markNotificationRead } from '../lib/notifications';
import { ALL_LANDMARKS } from '../data/regions';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { useBadges } from '../lib/BadgesContext';
import { msUntilStreakLapse } from '../lib/streaks';

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Live time left on a streak warning, shown at the right of its row. The
// streak lapses at the local midnight after the warning went out, the same
// boundary computeStreakDays counts by.
function StreakCountdown({ createdAt }) {
  const { checkedInToday } = useBadges();
  const sentMs = createdAt?.seconds ? createdAt.seconds * 1000 : Date.now();
  const lapseAt = sentMs + msUntilStreakLapse(new Date(sentMs));
  const [now, setNow] = useState(() => Date.now());
  const msLeft = lapseAt - now;
  const sameDay = msLeft > 0 && msLeft <= 24 * 60 * 60 * 1000;
  const ticking = sameDay && !checkedInToday;

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  let label;
  let color;
  if (sameDay && checkedInToday) {
    label = '\u2713 Kept';
    color = 'var(--color-green)';
  } else if (msLeft <= 0) {
    label = 'Expired';
    color = 'var(--color-parchment-dim)';
  } else {
    label = formatCountdown(msLeft);
    color = 'var(--color-brass-bright)';
  }
  return (
    <span
      className="streak-countdown"
      aria-label={ticking ? `${label} left` : label}
      style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: '0.9rem', color }}
    >
      {label}
    </span>
  );
}

// Everything that can ask for your attention, in one place, grouped by what
// it actually is rather than one flat feed: friend requests (their own
// collection, not a `notifications` doc, since they carry Accept/Decline
// actions the generic feed doesn't model), group-trip invites, and
// whatever else lands in `notifications` going forward.
export default function Notifications() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { requests, reload: reloadFriends } = useFriends();
  const toast = useToast();
  const [items, setItems] = useState(null); // null = first snapshot not in yet
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Optimistic overlays on top of server data: requests you just answered
  // vanish immediately, notifications you just opened dim immediately. The
  // live listener / FriendsContext reload catch up behind them.
  const [answeredIds, setAnsweredIds] = useState(() => new Set());
  const [readIds, setReadIds] = useState(() => new Set());

  useEffect(() => {
    if (!firebaseEnabled || !user) {
      setItems([]);
      return;
    }
    setItems(null);
    setLoadError(null);
    return subscribeMyNotifications(
      user.uid,
      (rows) => {
        setLoadError(null);
        setItems(rows);
      },
      (err) => setLoadError(err)
    );
  }, [firebaseEnabled, user, loadAttempt]);

  const toggleIn = (setter, id, on) =>
    setter((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const markRead = (n) =>
    runOptimistic({
      apply: () => toggleIn(setReadIds, n.id, true),
      commit: () => markNotificationRead(n.id),
      rollback: () => toggleIn(setReadIds, n.id, false),
      toast,
      errorMessage: friendlyError(null, "Couldn't mark that notification as read."),
      retry: () => markRead(n),
    });

  const openItem = (n) => {
    if (!n.read && !readIds.has(n.id)) markRead(n);
    if (n.groupTripId) {
      navigate(`/group/${n.groupTripId}`);
      return;
    }
    if (n.maprProjectId) {
      navigate('/mapr', { state: { openChats: true } });
      return;
    }
    if (n.featureRequestId) {
      navigate('/request-feature', { state: { tab: 'review' } });
      return;
    }
    if (n.landmarkId) {
      const landmark = ALL_LANDMARKS.find((l) => l.id === n.landmarkId);
      if (landmark) navigate(`/landmarks/${landmark.regionId}/${landmark.id}`);
    }
  };

  const answer = (r, accept) =>
    runOptimistic({
      apply: () => toggleIn(setAnsweredIds, r.id, true),
      commit: async () => {
        await (accept ? acceptRequest(r) : declineRequest(r));
        await reloadFriends();
      },
      rollback: () => toggleIn(setAnsweredIds, r.id, false),
      toast,
      errorMessage: friendlyError(
        null,
        accept ? `Couldn't accept @${r.fromName}'s request, so it's back.` : `Couldn't decline @${r.fromName}'s request, so it's back.`
      ),
      retry: () => answer(r, accept),
    });
  const handleAccept = (r) => answer(r, true);
  const handleDecline = (r) => answer(r, false);

  const visibleRequests = requests.filter((r) => !answeredIds.has(r.id));
  const loaded = items !== null;
  const shownItems = (items || []).map((n) => (readIds.has(n.id) ? { ...n, read: true } : n));
  const groupInvites = shownItems.filter((n) => n.type === 'group_invite');
  const otherUpdates = shownItems.filter((n) => n.type !== 'group_invite');
  // "All caught up" only once the feed actually loaded -- never as a stand-in
  // for "still loading" or "couldn't load".
  const isEmpty =
    loaded && !loadError && visibleRequests.length === 0 && groupInvites.length === 0 && otherUpdates.length === 0;

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F514}'}</span> Notifications
      </h1>

      {loadError && (
        <ErrorNotice
          message={friendlyError(loadError, "We couldn't load your notifications. Try again.")}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      )}
      {!loaded && !loadError && <SkeletonList count={4} label="Loading notifications" />}

      {isEmpty && (
        <p className="screen-subtitle">You're all caught up — nothing new right now.</p>
      )}

      {visibleRequests.length > 0 && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F465}'} Friend Requests</h3>
          {visibleRequests.map((r) => (
            <div key={r.id} className="friend-row">
              <span>@{r.fromName}</span>
              <span style={{ display: 'flex', gap: 6 }}>
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

      {groupInvites.length > 0 && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F3AB}'} Group Trip Invites</h3>
          {groupInvites.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => openItem(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openItem(n);
                }
              }}
              style={{
                padding: '10px 0',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                opacity: n.read ? 0.6 : 1,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{n.message}</p>
            </div>
          ))}
        </div>
      )}

      {otherUpdates.length > 0 && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F4E3}'} Other Updates</h3>
          {otherUpdates.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => openItem(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openItem(n);
                }
              }}
              style={{
                padding: '10px 0',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                opacity: n.read ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem', flex: 1 }}>{n.message}</p>
              {n.type === 'streak_warning' && <StreakCountdown createdAt={n.createdAt} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
