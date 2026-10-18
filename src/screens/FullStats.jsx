import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useBadges } from '../lib/BadgesContext';
import { ALL_BADGES, RARITY_ORDER } from '../lib/streaks';
import { levelProgress } from '../lib/level';
import CheckinsGallery from '../components/CheckinsGallery';
import { SkeletonCard } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { HOVER_CLICK_GRACE_MS, mouseOnly } from '../lib/mouseOnly';

const SORTS = [
  { id: 'oldest', label: 'Oldest' },
  { id: 'recent', label: 'Newest' },
  { id: 'rarity', label: 'Rarity' },
];

function fmtEarnedDate(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Earned badges bubble to the top under Oldest/Newest, oldest-earned (or
// most-recently-earned) first; badges you haven't gotten yet trail after in
// catalog order, still grayed out. Rarity ignores earned status entirely --
// it's a property of the badge itself, not of when (or whether) you got it.
function sortBadges(badgeEarnedAt, sortBy) {
  if (sortBy === 'rarity') {
    return [...ALL_BADGES].sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  }
  const earned = ALL_BADGES.filter((b) => badgeEarnedAt[b.id]);
  const unearned = ALL_BADGES.filter((b) => !badgeEarnedAt[b.id]);
  const seconds = (b) => badgeEarnedAt[b.id]?.seconds || 0;
  earned.sort((a, b) => (sortBy === 'oldest' ? seconds(a) - seconds(b) : seconds(b) - seconds(a)));
  return [...earned, ...unearned];
}

export default function FullStats() {
  const navigate = useNavigate();
  const { user, loading: authLoading, firebaseEnabled } = useAuth();
  const { claimedMap } = useCheckIn();
  const { stats, badges, badgeEarnedAt, reload: reloadStats } = useBadges();
  const [sortBy, setSortBy] = useState('recent');
  const badgeGridRef = useRef(null);
  // Which badge's description popover is open -- hover (desktop, with the
  // same short grace period as the header's profile popover) or tap
  // (mobile) both toggle it, same pattern as Profile's badge pills.
  const [openBadgeId, setOpenBadgeId] = useState(null);
  const gridRef = useRef(null);
  const closeTimer = useRef(null);
  const hoverOpened = useRef({ id: null, at: 0 });
  const openNow = (id) => {
    clearTimeout(closeTimer.current);
    if (openBadgeId !== id) hoverOpened.current = { id, at: Date.now() };
    setOpenBadgeId(id);
  };
  // A click right after the hover that opened this tile keeps it open.
  const toggleBadge = (id) => {
    const justHovered = hoverOpened.current.id === id && Date.now() - hoverOpened.current.at < HOVER_CLICK_GRACE_MS;
    setOpenBadgeId((cur) => (cur === id && !justHovered ? null : id));
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpenBadgeId(null), 250);
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    function handleClickOutside(e) {
      if (gridRef.current && !gridRef.current.contains(e.target)) setOpenBadgeId(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (authLoading) return <SkeletonCard lines={1} />;

  if (!firebaseEnabled || !user) {
    return (
      <div>
        <p className="screen-subtitle">Sign in on Profile to see your stats.</p>
        <button type="button" className="btn btn-ghost btn-block back-sticky" onClick={() => navigate('/profile')}>
          {'\u{2190}'} Back to Profile
        </button>
      </div>
    );
  }

  const earnedIds = new Set(badges.map((b) => b.id));
  const sorted = sortBadges(badgeEarnedAt, sortBy);
  // One row of badges at first (4 on a laptop, 2 on a phone: as many as fit),
  // then "Show more" opens the rest in a box that scrolls on its own.
  const [badgesOpen, setBadgesOpen] = useState(false);
  const perRow = useGridColumns(badgeGridRef);
  const visibleBadges = badgesOpen ? sorted : sorted.slice(0, perRow);
  const { level, pointsIntoLevel, pointsForNextLevel, pct } = levelProgress(stats?.totalPoints || 0);

  return (
    <div ref={gridRef}>
      <h1 className="screen-title">
        <span>{'\u{2B50}'}</span> Full Stats
      </h1>
      <button type="button" className="btn btn-ghost btn-block back-sticky" style={{ marginBottom: 24 }} onClick={() => navigate('/profile')}>
        {'\u{2190}'} Back to Profile
      </button>

      {/* Until stats land, "Level 1 · 0 pts" would be a wrong answer, not a placeholder. */}
      {stats?.failed ? (
        <ErrorNotice message="We couldn't load your level. Check your connection and try again." onRetry={() => reloadStats()} />
      ) : stats ? (
        <div className="card section">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{'\u{1F396}\u{FE0F}'} Level {level}</h3>
            <span className="screen-subtitle" style={{ margin: 0 }}>
              {pointsIntoLevel.toLocaleString()} / {pointsForNextLevel.toLocaleString()} pts
            </span>
          </div>
          <div className="level-bar-track" style={{ marginTop: 10 }}>
            <div className="level-bar-fill" style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="section" role="status" aria-live="polite">
          <span className="visually-hidden">Loading your level…</span>
          <SkeletonCard lines={1} />
        </div>
      )}

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>{'\u{1F3C5}'} All Badges</h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          {badges.length} of {ALL_BADGES.length} earned
        </p>
        <div className="tabs" style={{ marginBottom: 14 }}>
          {SORTS.map((s) => (
            <button key={s.id} className={`tab-btn ${sortBy === s.id ? 'active' : ''}`} aria-pressed={!!(sortBy === s.id)} onClick={() => setSortBy(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div ref={badgeGridRef} className={`badges-full-grid ${badgesOpen ? 'badges-scroll' : ''}`}>
          {visibleBadges.map((b) => {
            const earned = earnedIds.has(b.id);
            const open = openBadgeId === b.id;
            return (
              <div
                key={b.id}
                className={`badge-tile ${earned ? 'earned' : 'locked'}`}
                onPointerEnter={mouseOnly(() => openNow(b.id))}
                onPointerLeave={mouseOnly(closeSoon)}
                onClick={() => toggleBadge(b.id)}
              >
                <span className="badge-tile-icon">{b.icon}</span>
                <span className="badge-tile-label">{b.label}</span>
                {earned && <span className="badge-tile-date">{fmtEarnedDate(badgeEarnedAt[b.id]?.seconds)}</span>}
                {open && (
                  <div
                    className="points-popover"
                    style={{ top: 'calc(100% + 8px)', left: '50%', right: 'auto', transform: 'translateX(-50%)', whiteSpace: 'normal', width: 160, fontWeight: 400 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {b.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {sorted.length > perRow && (
          <button type="button" className="btn btn-ghost btn-sm badges-more" aria-expanded={badgesOpen} onClick={() => setBadgesOpen((o) => !o)}>
            {badgesOpen ? 'Show less' : `Show more (${sorted.length - perRow})`}
          </button>
        )}
      </div>

      <CheckinsGallery user={user} claimedMap={claimedMap} navigate={navigate} totalPoints={stats?.failed ? '–' : stats ? stats.totalPoints || 0 : null} />
    </div>
  );
}

// How many badge tiles fit in one row of the grid (its CSS: columns at least
// BADGE_MIN_PX wide, BADGE_GAP_PX apart). Follows the grid's width.
const BADGE_MIN_PX = 110;
const BADGE_GAP_PX = 10;
function columnsFor(width) {
  return Math.max(1, Math.floor((width + BADGE_GAP_PX) / (BADGE_MIN_PX + BADGE_GAP_PX)));
}
function useGridColumns(ref) {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => el.clientWidth > 0 && setCols(columnsFor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}
