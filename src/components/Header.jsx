import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useAdminMode } from '../lib/AdminModeContext';
import { closeSoloToday, ensureSoloStreak, subscribeMySoloStreak, watchNewCheckins } from '../lib/soloStreaks';
import { subscribeLeaderboard, rankOf, getMyLeaderboardEntry, cleanName } from '../lib/leaderboard';
import { readPersisted, writePersisted } from '../lib/usePersistentState';

// Shared with Profile and the full standings page (FullLeaderboard.jsx).
const LEADERBOARD_PERIOD_KEY = 'leaderboard.period';
import { subscribeMyNotifications } from '../lib/notifications';
import { useTodayKey } from '../lib/useTodayKey';
import { useOptionalBadges } from '../lib/BadgesContext';
import { msUntilStreakLapse, displayStreakCount, isDayHeld, PICKS_STREAK_THRESHOLD } from '../lib/streaks';
import { Skeleton } from './Skeleton';
import { useInStreakWarningWindow } from '../lib/useStreakWarning';

function formatLeft(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}

// A segmented, digital-style countdown (H : M : S, each digit pair in its
// own tinted tile) instead of a flat "6h 32m 23s" text line -- reads at a
// glance the way a real countdown does. The tint (green once secured, red
// once at risk) carries the same signal color the header flame itself
// uses. The visible segments are decorative (aria-hidden); the plain
// formatLeft string underneath is what a screen reader actually announces.
function CountdownClock({ ms, secured }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const segments = h > 0 ? [[pad(h), 'h'], [pad(m), 'm'], [pad(s), 's']] : [[pad(m), 'm'], [pad(s), 's']];
  return (
    <div className={`streak-clock ${secured ? 'secured' : 'at-risk'}`}>
      <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {segments.map(([value, unit], i) => (
          <span className="streak-clock-seg" key={unit}>
            {i > 0 && <span className="streak-clock-sep">:</span>}
            <span className="streak-clock-value">{value}</span>
            <span className="streak-clock-unit">{unit}</span>
          </span>
        ))}
      </div>
      <span className="visually-hidden">{formatLeft(ms)} left</span>
    </div>
  );
}

// Rendered through a portal straight onto document.body -- NOT nested
// inside the header/map DOM tree at all. This popover kept rendering
// transparent over the Map tab's Leaflet view no matter how forcefully its
// background was pinned in CSS (solid color, !important, a high z-index):
// a real compositing/paint bug tied to sitting in the same branch as the
// map's own layers, not a stylesheet mistake. Escaping to the body
// sidesteps that class of bug entirely instead of fighting it with more
// CSS. Positioned by JS off the trigger button's own bounding rect since
// it's no longer a CSS-positioned descendant of that button.
function StreakPopoverPortal({ open, triggerRef, onRequestClose, children }) {
  const popoverRef = useRef(null);
  const [rect, setRect] = useState(null);
  // Callers pass a new onRequestClose every render; reading it through a ref
  // keeps the listener effect below from re-running (and re-measuring, which
  // re-renders) on every render, a loop that never settled.
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  // The popover is centered under its trigger, which sits near the left edge
  // of the header -- a wide one ran off the left of the screen. Measured
  // after render and nudged back inside the viewport.
  const [clampedLeft, setClampedLeft] = useState(null);
  // Runs after every render on purpose (the popover's width follows its
  // content). React skips the re-render when the value is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!open || !rect || !popoverRef.current) return;
    const width = popoverRef.current.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const center = rect.left + rect.width / 2;
    const margin = 8;
    setClampedLeft(Math.max(margin + width / 2, Math.min(center, vw - margin - width / 2)));
  });

  useEffect(() => {
    if (!open) return undefined;
    const update = () => setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const close = (e) => {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open, triggerRef]);

  if (!open || !rect) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className="points-popover streak-popover"
      role="status"
      style={{
        position: 'fixed',
        top: rect.bottom + 18,
        left: clampedLeft ?? rect.left + rect.width / 2,
        right: 'auto',
        transform: 'translateX(-50%)',
      }}
    >
      {children}
    </div>,
    document.body
  );
}

// The personal, solo streak -- back after being retired at #405, now a
// server-authority streaks/{uid} doc (mode: 'solo') instead of a live
// computation, so a freeze actually shows up here. One 🔥, distinct from
// the dual streak's two (🔥🔥) badge next to it in the header, so the two
// are never confused for one number. Flame animates only while there's a
// streak to celebrate. Always shown green once today's already closed
// (lastCompletedDay is today -- the real server-authority signal from
// api/close-solo-streak-day.js), red otherwise -- no in-between color.
// Tapping it opens a live countdown to local midnight. ensureSoloStreak
// here (not just on the Your Streaks page) means the doc -- and, for
// anyone with a pre-existing streak, its seeded-from-real-history count --
// exists from the first screen this account ever lands on, not only after
// visiting Your Streaks once; it's idempotent, so calling it again there
// too is harmless.
function StreakBadge() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const today = useTodayKey();
  // Tagged with the account it was read for, so after switching accounts the
  // previous account's streak never shows while the new one loads.
  const [loaded, setLoaded] = useState({ uid: null, streak: null });
  const streak = user && loaded.uid === user.uid ? loaded.streak : null;
  const [open, setOpen] = useState(false);
  const [msLeft, setMsLeft] = useState(() => msUntilStreakLapse());
  const ref = useRef(null);

  // A check-in or rating anywhere in the app (check-in sheet, Rate a
  // Landmark, Add Landmark) asks the server to close today as soon as it
  // lands. The server counts today's 3 itself; this badge then turns green
  // and counts up from its live streak doc, no reload needed.
  const securedRef = useRef(false);
  securedRef.current = isDayHeld(streak, today);
  const uid = user?.uid;
  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    return watchNewCheckins(uid, () => {
      if (securedRef.current) return;
      closeSoloToday().catch(() => {});
    });
  }, [firebaseEnabled, uid]);

  // The watcher above only sees check-ins that land while this page is open
  // and listening. One made elsewhere (another device, the iPhone app, a
  // backgrounded tab) never fired it, so 3 check-ins could leave the day
  // open for good (owner report 2026-10-17). The badge counter reloads after
  // every check-in and on return to the app: at 3 today and not yet closed,
  // ask the server once per count (a failed call tries again next reload).
  // One real check-in secures the day too (checkedInToday), not only 3.
  const badgeCounts = useOptionalBadges();
  const actionsToday = badgeCounts?.actionsToday ?? 0;
  const dayEarned = !!badgeCounts?.checkedInToday || actionsToday >= PICKS_STREAK_THRESHOLD;
  const closeAskedFor = useRef('');
  const [closeRetry, setCloseRetry] = useState(0);
  const held = isDayHeld(streak, today);
  useEffect(() => {
    if (!firebaseEnabled || !uid || !streak || held || !dayEarned) return;
    const key = `${uid}:${today}:${actionsToday}`;
    if (closeAskedFor.current === key) return;
    closeAskedFor.current = key;
    let timer = null;
    const retryLater = () => {
      closeAskedFor.current = '';
      timer = setTimeout(() => setCloseRetry((n) => n + 1), 30_000);
    };
    closeSoloToday(today)
      .then((r) => {
        if (!r?.ok) retryLater();
      })
      .catch(retryLater);
    return () => clearTimeout(timer);
  }, [firebaseEnabled, uid, streak, held, dayEarned, actionsToday, today, closeRetry]);

  useEffect(() => {
    if (!firebaseEnabled || !user) return undefined;
    const uid = user.uid;
    let cancelled = false;
    // Keep the unsubscribe: handing it back from the .then() below returns it
    // to nobody, which left a live listener behind every time `user` changed.
    let unsubscribe = null;
    const subscribe = () => {
      if (cancelled || unsubscribe) return;
      const onStreak = (next) =>
        setLoaded((cur) => (cur.uid === uid && cur.streak === next ? cur : { uid, streak: next }));
      unsubscribe = subscribeMySoloStreak(uid, onStreak, () => {});
    };
    ensureSoloStreak(user.displayName || 'A traveler', user.uid)
      .then(subscribe)
      // The set-up call failing (offline, server hiccup) shouldn't hide an
      // existing streak from the badge.
      .catch(subscribe);
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [firebaseEnabled, user]);

  useEffect(() => {
    if (!open) return undefined;
    setMsLeft(msUntilStreakLapse());
    const id = setInterval(() => setMsLeft(msUntilStreakLapse()), 1000);
    return () => clearInterval(id);
  }, [open]);
  const warnWindow = useInStreakWarningWindow();

  if (!firebaseEnabled || !user) return null;

  // A lapsed streak (a missed day, no freeze) keeps its old stored count until
  // the next close resets it -- show the real, already-broken 0 instead.
  const count = displayStreakCount(streak);
  const active = count > 0;
  const secured = isDayHeld(streak, today);
  // Red only in the day's last 5 hours; earlier, an unsecured day is plain.
  const tint = !streak ? '' : secured ? 'secured' : warnWindow ? 'at-risk' : '';

  return (
    <div className="header-streak-wrap" ref={ref}>
      <button
        type="button"
        className={`header-streak ${active ? 'active' : ''} ${tint}`}
        aria-expanded={open}
        aria-label={`${count}-day solo streak${streak ? `, today ${secured ? 'secured' : 'not secured yet'}` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="header-streak-flame" aria-hidden="true">
          {'\u{1F525}'}
        </span>
        <span className="header-streak-num">{count}</span>
      </button>
      <StreakPopoverPortal open={open} triggerRef={ref} onRequestClose={() => setOpen(false)}>
        {!active ? (
          <>
            <div>Check in or rate 3 landmarks today to start a streak</div>
            <button
              type="button"
              className="btn btn-primary btn-sm streak-popover-cta"
              onClick={() => {
                setOpen(false);
                navigate('/streaks');
              }}
            >
              {'\u{1F525}'} Start it
            </button>
          </>
        ) : (
          <>
            <div className="points-popover-joined">
              {!secured ? `${count}-day streak ends in` : "Today's secured ✓ — new day starts in"}
            </div>
            <CountdownClock ms={msLeft} secured={secured} />
            {!secured && (
              <button
                type="button"
                className="btn btn-primary btn-sm streak-popover-cta"
                onClick={() => {
                  setOpen(false);
                  navigate('/streaks');
                }}
              >
                {'\u{1F525}'} Keep it alive
              </button>
            )}
          </>
        )}
      </StreakPopoverPortal>
    </div>
  );
}

// Standings (owner, 2026-10-18: replaces the dual streak's 🔥🔥 badge).
// Shows your points for the chosen period; tapping opens your rank, the top
// of the board with you in it, who's just ahead, and a link to the full
// standings page. Week / Month / Year is the same choice Profile and the
// full standings page remember (leaderboard.period).
const STANDINGS_PERIODS = [
  { id: 'weekly', label: 'Week' },
  { id: 'monthly', label: 'Month' },
  { id: 'yearly', label: 'Year' },
];
const STANDINGS_TOP = 5;
function StandingsBadge() {
  const { user, firebaseEnabled } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriodState] = useState(() => {
    const saved = readPersisted(LEADERBOARD_PERIOD_KEY);
    return STANDINGS_PERIODS.some((p) => p.id === saved) ? saved : 'weekly';
  });
  const setPeriod = (id) => {
    setPeriodState(id);
    writePersisted(LEADERBOARD_PERIOD_KEY, id);
  };
  // { uid, period, entries, me: { points, rank } } -- tagged so another
  // account's or period's numbers never show while the next ones load.
  const [board, setBoard] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const uid = user?.uid;

  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    let cancelled = false;
    let seq = 0;
    const unsub = subscribeLeaderboard(
      period,
      (entries) => {
        const mySeq = ++seq;
        const idx = entries.findIndex((e) => e.userId === uid);
        if (idx >= 0) {
          setBoard({ uid, period, entries, me: { points: entries[idx].points, rank: rankOf(entries, idx) } });
          return;
        }
        // Not in the top 50: your real points, unranked.
        getMyLeaderboardEntry(period, uid)
          .then((mine) => !cancelled && mySeq === seq && setBoard({ uid, period, entries, me: { points: mine?.points || 0, rank: null } }))
          .catch(() => !cancelled && mySeq === seq && setBoard({ uid, period, entries, me: { points: 0, rank: null } }));
      },
      50,
      () => !cancelled && setBoard({ uid, period, entries: [], me: null, failed: true })
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [firebaseEnabled, uid, period]);

  if (!firebaseEnabled || !user) return null;

  const current = board && board.uid === uid && board.period === period ? board : null;
  const me = current?.me;
  const entries = current?.entries || [];
  const myIdx = entries.findIndex((e) => e.userId === uid);
  // The next person above you (fewer points than them, so a real gap).
  const ahead = myIdx > 0 ? [...entries.slice(0, myIdx)].reverse().find((e) => e.points > entries[myIdx].points) : null;
  const periodLabel = STANDINGS_PERIODS.find((p) => p.id === period).label;

  return (
    <div className="header-streak-wrap" ref={ref}>
      <button
        type="button"
        className="header-streak header-standings"
        aria-expanded={open}
        aria-label={me ? `Standings: ${me.points} points this ${periodLabel.toLowerCase()}${me.rank ? `, rank ${me.rank}` : ''}` : 'Standings'}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{'\u{1F3C6}'}</span>
        <span className="header-streak-num">{me ? me.points.toLocaleString() : '–'}</span>
      </button>
      <StreakPopoverPortal open={open} triggerRef={ref} onRequestClose={() => setOpen(false)}>
        <div className="standings-pop">
          <div className="tabs standings-tabs" role="group" aria-label="Standings period">
            {STANDINGS_PERIODS.map((p) => (
              <button key={p.id} type="button" className={`tab-btn ${period === p.id ? 'active' : ''}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {!current ? (
            <div role="status" aria-live="polite">
              <span className="visually-hidden">Loading standings…</span>
              <Skeleton className="skeleton-inline" width={140} height={14} />
            </div>
          ) : current.failed ? (
            <div>Couldn&apos;t load the standings. Try again in a moment.</div>
          ) : (
            <>
              <div className="standings-me">
                <span className="standings-me-rank">{me.rank ? `#${me.rank}` : 'Unranked'}</span>
                <span className="standings-me-pts">{me.points.toLocaleString()} pts this {periodLabel.toLowerCase()}</span>
              </div>
              {ahead && (
                <div className="streak-popover-hint">
                  {(ahead.points - entries[myIdx].points).toLocaleString()} pts behind @{cleanName(ahead.userName)}
                </div>
              )}
              {entries.length > 0 ? (
                <ol className="standings-list">
                  {entries.slice(0, STANDINGS_TOP).map((e, i) => (
                    <li key={e.userId} className={e.userId === uid ? 'mine' : ''}>
                      <span className="standings-rank">#{rankOf(entries, i)}</span>
                      <span className="standings-name">@{cleanName(e.userName)}</span>
                      <span className="standings-pts">{(e.points || 0).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="streak-popover-hint">No points yet this {periodLabel.toLowerCase()}. Check in to be first.</div>
              )}
            </>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm streak-popover-cta"
            onClick={() => {
              setOpen(false);
              navigate(`/leaderboard/full?period=${period}`);
            }}
          >
            {'\u{1F3C6}'} Full standings
          </button>
        </div>
      </StreakPopoverPortal>
    </div>
  );
}

// Red count bubble for unread notifications and pending friend requests.
// Sits on a corner of whatever it's inside (which must be position: relative)
// and lets taps through to it.
function CountBadge({ count }) {
  if (!(count > 0)) return null;
  return (
    <span className="notif-badge" role="status" aria-label={`${count} ${count === 1 ? 'notification' : 'notifications'}`}>
      {count > 9 ? '9+' : count}
    </span>
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
    let cancelled = false;
    // Another account's numbers never carry over, and only the newest
    // snapshot's lookup may land (an older one resolving late used to
    // overwrite a fresh top-50 rank).
    setMe(null);
    let seq = 0;
    const unsub = subscribeLeaderboard('weekly', (entries) => {
      const mySeq = ++seq;
      const idx = entries.findIndex((e) => e.userId === user.uid);
      if (idx >= 0) {
        setMe({ points: entries[idx].points, rank: rankOf(entries, idx) });
        return;
      }
      // Not in the top 50: show your real points (unranked), not "0 pts".
      getMyLeaderboardEntry('weekly', user.uid)
        .then((mine) => !cancelled && mySeq === seq && setMe({ points: mine?.points || 0, rank: null }))
        .catch(() => !cancelled && mySeq === seq && setMe({ points: 0, rank: null }));
    }, 50, () => setMe({ points: null, rank: null, failed: true }));
    return () => {
      cancelled = true;
      unsub();
    };
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
    const handleKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  if (!firebaseEnabled) return null;

  // Signed out: says plainly what it does, straight to /profile to sign in.
  if (!user) {
    return (
      <Link to="/profile" className="score-chip score-chip-join" title="Sign in">
        Sign in
      </Link>
    );
  }

  const name = myUsername ? `@${myUsername}` : user.displayName || 'Explorer';
  const notificationCount = unread + requests.length;

  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="score-chip profile-menu-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="score-chip-pts">{name}</span>
        <span className="profile-menu-caret">{'▾'}</span>
      </button>
      {/* Also on the username pill itself, so a new notification shows without
          opening the menu. */}
      <CountBadge count={notificationCount} />
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
              <CountBadge count={notificationCount} />
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
      <div className="app-header-center" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <StreakBadge />
        <StandingsBadge />
      </div>
      <div className="app-header-actions">
        <ProfileMenu />
      </div>
    </header>
  );
}
