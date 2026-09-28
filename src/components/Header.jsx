import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useAdminMode } from '../lib/AdminModeContext';
import { useBadges } from '../lib/BadgesContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { subscribeLeaderboard } from '../lib/leaderboard';
import { subscribeMyNotifications } from '../lib/notifications';
import { msUntilStreakLapse, PICKS_STREAK_THRESHOLD } from '../lib/streaks';
import { Skeleton } from './Skeleton';

function formatLeft(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}

// Dead center of the header, on every screen -- same spot and same visual
// language the solo-streak flame used before it was retired (#405), now
// fed by a pair's streak instead of a personal one. Flame animates only
// once a pair has an actual streak (count > 0) and turns warning-colored
// once YOUR OWN side of today's quota isn't secured yet. Tapping opens a
// live countdown to the local-midnight deadline -- the same lightweight
// popover as before; the full "who it's with / how long / today's status"
// picture lives in Your Stats -> the streak tile instead (StreakPopup.jsx).
function PairStreakBadge() {
  const { user, firebaseEnabled } = useAuth();
  const { streaks } = usePairStreaks();
  const { actionsToday } = useBadges();
  const [open, setOpen] = useState(false);
  const [msLeft, setMsLeft] = useState(() => msUntilStreakLapse());
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMsLeft(msUntilStreakLapse());
    const id = setInterval(() => setMsLeft(msUntilStreakLapse()), 1000);
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      clearInterval(id);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  if (!firebaseEnabled || !user) return null;

  // The streak you're most invested in, if you have more than one -- just
  // the highest count, ties broken by whichever sorts first.
  const primary = streaks.length ? streaks.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const active = !!primary && primary.count > 0;
  const atRisk = !!primary && actionsToday < PICKS_STREAK_THRESHOLD;
  const partnerName = primary
    ? Object.entries(primary.memberNames || {}).find(([uid]) => uid !== user.uid)?.[1]
    : null;

  return (
    <div className="header-streak-wrap" ref={ref}>
      <button
        type="button"
        className={`header-streak ${active ? 'active' : ''} ${primary && atRisk ? 'at-risk' : ''}`}
        aria-expanded={open}
        aria-label="Dual streak"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="header-streak-flame" aria-hidden="true">
          {'\u{1F525}'}
        </span>
        <span className="header-streak-num">{primary ? primary.count : 0}</span>
      </button>
      {open && (
        <div className="points-popover streak-popover" role="status">
          {!primary ? (
            <div>Invite a friend to start a streak</div>
          ) : (
            <>
              <div className="points-popover-joined">
                {atRisk
                  ? `Streak with @${partnerName} ends in`
                  : `Today's secured with @${partnerName} — new day starts in`}
              </div>
              <div className={`streak-popover-clock ${atRisk ? 'at-risk' : ''}`}>{formatLeft(msLeft)}</div>
              {atRisk && (
                <div className="streak-popover-hint">
                  Vote or rate {PICKS_STREAK_THRESHOLD} landmarks in Mapr Travel Picks
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Header identity control. Shows who you're signed in as; tapping reveals this week's rank/points, a "Notifications"
// link (badged with the unread count), and "View Profile". Notifications
// live inside this dropdown rather than as their own header icon -- a
// second always-visible icon here has no room next to the wordmark on a
// narrow phone.
function ProfileMenu() {
  const { user, firebaseEnabled } = useAuth();
  const { myUsername, requests } = useFriends();
  const { adminMode, canUseAdminMode, setAdminMode } = useAdminMode();
  const navigate = useNavigate();
  const [me, setMe] = useState(null); // { points, rank } for the current week
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!firebaseEnabled || !user) {
      setMe(null);
      return;
    }
    const unsub = subscribeLeaderboard('weekly', (entries) => {
      const idx = entries.findIndex((e) => e.userId === user.uid);
      setMe({ points: idx >= 0 ? entries[idx].points : 0, rank: idx >= 0 ? idx + 1 : null });
    }, 50, () => setMe({ points: null, rank: null, failed: true }));
    return unsub;
  }, [firebaseEnabled, user]);

  useEffect(() => {
    if (!firebaseEnabled || !user) {
      setUnread(0);
      return;
    }
    return subscribeMyNotifications(user.uid, (items) => setUnread(items.filter((n) => !n.read).length));
  }, [firebaseEnabled, user]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!firebaseEnabled) return null;

  // Signed out: a gentle nudge to join the competition, straight to /profile.
  if (!user) {
    return (
      <Link to="/profile" className="score-chip score-chip-join" title="Sign in to compete">
        {'\u{1F3C6}'} Compete
      </Link>
    );
  }

  const name = myUsername ? `@${myUsername}` : user.displayName || 'Explorer';
  const notificationCount = unread + requests.length;

  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="score-chip profile-menu-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="score-chip-pts">{name}</span>
        <span className="profile-menu-caret">{'▾'}</span>
      </button>
      {open && (
        <div className="points-popover">
          <div className="points-popover-joined">This Week</div>
          {/* Before the weekly board's first snapshot, "— · 0 pts" would read
              as a real (and discouraging) answer -- show a placeholder instead. */}
          {me ? (
            <div>
              {'\u{1F3C6}'} {me.failed ? "Couldn't load this week's rank" : <>{me.rank ? `#${me.rank}` : '—'} {'·'} {me.points.toLocaleString()} pts</>}
            </div>
          ) : (
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="visually-hidden">Loading this week's rank…</span>
              {'\u{1F3C6}'} <Skeleton className="skeleton-inline" width={90} height={13} />
            </div>
          )}
          {/* Admin account only -- same switch as Settings -> Admin Mode. */}
          {canUseAdminMode && (
            <label className="admin-mode-switch">
              <span>{'\u{1F6E0}\u{FE0F}'} Admin Mode</span>
              <input
                type="checkbox"
                role="switch"
                checked={adminMode}
                onChange={(e) => setAdminMode(e.target.checked)}
              />
              <span className="admin-mode-switch-track" aria-hidden="true" />
            </label>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ position: 'relative', flex: 1 }}
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
            >
              {'\u{1F514}'} Notifications
              {notificationCount > 0 && (
                <span
                  aria-label={`${notificationCount} notifications`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 8,
                    background: 'var(--color-error, #b3503f)',
                    color: '#fff',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    lineHeight: 1,
                  }}
                >
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </button>
            <Link to="/profile" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => setOpen(false)}>
              View Profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  return (
    <header className="app-header">
      {/* Logo only -- the wordmark next to it used to crowd this pill on
          narrow phones, and the mark alone is identifiable enough. */}
      <Link to="/" aria-label="Landmark Hunters" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
        <img src="/logo.png" alt="Landmark Hunters" className="brand-mark" />
      </Link>
      <div className="app-header-center">
        <PairStreakBadge />
      </div>
      <div className="app-header-actions">
        <ProfileMenu />
      </div>
    </header>
  );
}
