import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { acceptRequest, declineRequest, requestKey } from '../lib/friends';
import { subscribeMyNotifications, markNotificationRead, markNotificationsRead } from '../lib/notifications';
import { noticeAge, noticeParts } from '../lib/noticeFormat';
import { ALL_LANDMARKS } from '../data/regions';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { onboardingStatus } from '../lib/onboardingVersion';
import { SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { subscribeMySoloStreak } from '../lib/soloStreaks';
import { useVisibleInterval } from '../lib/useVisibleInterval';
import { msUntilStreakLapse, dayKey, isDayHeld } from '../lib/streaks';

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Live time left on a streak warning, shown at the right of its row. The
// streak lapses at the local midnight after the warning went out -- same
// boundary, and same server-authority "secured" signal (lastCompletedDay)
// Header's badge and the warning banner use, so this can never disagree
// with either.
function StreakCountdown({ createdAt }) {
  const { user } = useAuth();
  const [soloStreak, setSoloStreak] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    return subscribeMySoloStreak(user.uid, setSoloStreak, () => {});
  }, [user]);
  // isDayHeld, like Header: a freeze spent today keeps the streak too.
  const checkedInToday = isDayHeld(soloStreak, dayKey(new Date()));
  const sentMs = createdAt?.seconds ? createdAt.seconds * 1000 : Date.now();
  const lapseAt = sentMs + msUntilStreakLapse(new Date(sentMs));
  const [now, setNow] = useState(() => Date.now());
  const msLeft = lapseAt - now;
  const sameDay = msLeft > 0 && msLeft <= 24 * 60 * 60 * 1000;
  const ticking = sameDay && !checkedInToday;

  useVisibleInterval(() => setNow(Date.now()), 1000, ticking);

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
  const { user, loading: authLoading, firebaseEnabled } = useAuth();
  const { requests, reload: reloadFriends, myProfile, profileFresh } = useFriends();
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
    if (authLoading) return;
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
  }, [firebaseEnabled, user, authLoading, loadAttempt]);

  // An "Onboarding has been updated" notice for an account that has already
  // finished the current onboarding has nothing to open (the /onboarding route
  // sends it straight back to Profile), and it would keep the red badge up for
  // nothing. Mark those read once the real profile is known.
  const onboardingDone = profileFresh && !!myProfile && onboardingStatus(myProfile) === 'complete';
  useEffect(() => {
    if (!onboardingDone || !items) return;
    for (const n of items) {
      if (n.type === 'onboarding_update' && !n.read) markNotificationRead(n.id).catch(() => {});
    }
  }, [onboardingDone, items]);

  // Seeing the list is reading it (owner, 2026-11-25): everything unread in
  // it is marked read at once, so the badge clears without a tap per row.
  // What was new on this visit stays marked New (the green dot) until you
  // leave, so you can still tell what arrived. The onboarding notice keeps
  // its own rule (it clears once onboarding is finished, above).
  const [newIds, setNewIds] = useState(() => new Set());
  // Each notice is marked once per visit, however often the list re-renders.
  const marked = useRef(new Set());
  const uid = user?.uid || null;
  useEffect(() => {
    if (!items || !uid) return;
    const fresh = items.filter((n) => !n.read && n.type !== 'onboarding_update' && !marked.current.has(n.id)).map((n) => n.id);
    if (!fresh.length) return;
    for (const id of fresh) marked.current.add(id);
    setNewIds((cur) => new Set([...cur, ...fresh]));
    setReadIds((cur) => new Set([...cur, ...fresh]));
    markNotificationsRead(fresh).catch(() => {
      // Couldn't save it: they show unread again, and the next visit tries again.
      setReadIds((cur) => new Set([...cur].filter((id) => !fresh.includes(id))));
    });
  }, [items, uid]);

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
    // The onboarding notice only clears once onboarding is finished (see
    // Onboarding.jsx); opening it and walking away leaves it unread.
    if (!n.read && !readIds.has(n.id) && n.type !== 'onboarding_update') markRead(n);
    if (n.type === 'onboarding_update') {
      if (onboardingDone) {
        // Nothing left to finish: clear it instead of opening an empty screen.
        if (!n.read && !readIds.has(n.id)) markRead(n);
        toast.show('Onboarding is already finished.', { tone: 'success', durationMs: 3000 });
        return;
      }
      navigate('/onboarding');
      return;
    }
    if (n.type === 'streak_warning') {
      navigate('/streaks');
      return;
    }
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
    if (n.bugReportId) {
      navigate('/report-bug', { state: { tab: 'review' } });
      return;
    }
    // A tag carries its place's region, so places outside the built-in
    // catalog (imported or added ones) open too.
    // A rating tag opens the place scrolled to the rating you were tagged in.
    const state = n.type === 'rating_tag' && n.fromUid ? { focusReviewId: `${n.fromUid}_${n.landmarkId}` } : undefined;
    if (n.landmarkId && n.regionId) {
      navigate(`/landmarks/${n.regionId}/${n.landmarkId}`, { state });
      return;
    }
    if (n.landmarkId) {
      const landmark = ALL_LANDMARKS.find((l) => l.id === n.landmarkId);
      if (landmark) navigate(`/landmarks/${landmark.regionId}/${landmark.id}`, { state });
    }
  };

  const answer = (r, accept) =>
    runOptimistic({
      apply: () => toggleIn(setAnsweredIds, requestKey(r), true),
      commit: async () => {
        await (accept ? acceptRequest(r) : declineRequest(r));
        await reloadFriends();
      },
      rollback: () => toggleIn(setAnsweredIds, requestKey(r), false),
      toast,
      errorMessage: friendlyError(
        null,
        accept ? `Couldn't accept @${r.fromName}'s request, so it's back.` : `Couldn't decline @${r.fromName}'s request, so it's back.`
      ),
      retry: () => answer(r, accept),
    });
  const handleAccept = (r) => answer(r, true);
  const handleDecline = (r) => answer(r, false);

  const visibleRequests = requests.filter((r) => !answeredIds.has(requestKey(r)));
  const loaded = items !== null;
  const shownItems = (items || []).map((n) => (readIds.has(n.id) ? { ...n, read: true } : n));
  const groupInvites = shownItems.filter((n) => n.type === 'group_invite');
  const otherUpdates = shownItems.filter((n) => n.type !== 'group_invite');
  // "All caught up" only once the feed actually loaded -- never as a stand-in
  // for "still loading" or "couldn't load".
  const isEmpty =
    loaded && !loadError && visibleRequests.length === 0 && groupInvites.length === 0 && otherUpdates.length === 0;

  // A row: its icon, the words, when it came, and a dot while it's new.
  const renderRow = (n, children = null) => {
    const { icon, text } = noticeParts(n);
    const fresh = newIds.has(n.id) || !n.read;
    return (
      <li key={n.id} className={`notif-row${fresh ? ' is-new' : ''}`}>
        <button type="button" className="notif-row-main" onClick={() => openItem(n)}>
          <span className="notif-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="notif-text">
            <span className="notif-message">{text}</span>
            <span className="notif-meta">
              {fresh && <span className="notif-new">New</span>}
              {noticeAge(n)}
            </span>
          </span>
          {children}
          {fresh && <span className="notif-dot" aria-label="New" />}
        </button>
      </li>
    );
  };

  return (
    <div className="notif-screen">
      <h1 className="screen-title notif-title">Notifications</h1>

      {loadError && (
        <ErrorNotice
          message={friendlyError(loadError, "We couldn't load your notifications. Try again.")}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      )}
      {!loaded && !loadError && <SkeletonList count={4} label="Loading notifications" />}

      {isEmpty && <p className="notif-empty">You're all caught up. Nothing new right now.</p>}

      {visibleRequests.length > 0 && (
        <section className="notif-section" aria-label="Friend requests">
          <p className="notif-section-label">Friend requests</p>
          <ul className="notif-list">
            {visibleRequests.map((r) => (
              <li key={r.id} className="notif-row is-new notif-request">
                <span className="notif-icon" aria-hidden="true">
                  {'\u{1F465}'}
                </span>
                <span className="notif-text">
                  <span className="notif-message">@{r.fromName} wants to be friends</span>
                </span>
                <span className="notif-actions">
                  <button type="button" className="btn btn-primary btn-tight" onClick={() => handleAccept(r)}>
                    Accept
                  </button>
                  <button type="button" className="btn btn-ghost btn-tight" onClick={() => handleDecline(r)}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groupInvites.length > 0 && (
        <section className="notif-section" aria-label="Group trip invites">
          <p className="notif-section-label">Group trip invites</p>
          <ul className="notif-list">
            {groupInvites.map((n) =>
              renderRow(
                n,
                <span className="notif-chevron" aria-hidden="true">
                  {'\u203A'}
                </span>
              )
            )}
          </ul>
        </section>
      )}

      {otherUpdates.length > 0 && (
        <section className="notif-section" aria-label="Updates">
          <p className="notif-section-label">Updates</p>
          <ul className="notif-list">
            {otherUpdates.map((n) =>
              renderRow(
                n,
                <>
                  {n.type === 'streak_warning' && <StreakCountdown createdAt={n.createdAt} />}
                  {n.type === 'rating_tag' && n.landmarkId && <span className="notif-link">View rating {'\u203A'}</span>}
                </>
              )
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
