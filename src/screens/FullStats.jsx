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
  // Which badge's description popover is open -- hover (desktop, with the
  // same short grace period as the header's profile popover) or tap
  // (mobile) both toggle it, same pattern as Profile's badge pills.
  const [openBadgeId, setOpenBadgeId] = useState(null);
  const gridRef = useRef(null);
  const closeTimer = useRef(null);
  const openNow = (id) => {
    clearTimeout(closeTimer.current);
    setOpenBadgeId(id);
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
        <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
          {'\u{2190}'} Back to Profile
        </button>
      </div>
    );
  }

  const earnedIds = new Set(badges.map((b) => b.id));
  const sorted = sortBadges(badgeEarnedAt, sortBy);
  const { level, pointsIntoLevel, pointsForNextLevel, pct } = levelProgress(stats?.totalPoints || 0);

  return (
    <div ref={gridRef}>
      <h1 className="screen-title">
        <span>{'\u{2B50}'}</span> Full Stats
      </h1>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => navigate('/profile')}>
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
            <button key={s.id} className={`tab-btn ${sortBy === s.id ? 'active' : ''}`} onClick={() => setSortBy(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="badges-full-grid">
          {sorted.map((b) => {
            const earned = earnedIds.has(b.id);
            const open = openBadgeId === b.id;
            return (
              <div
                key={b.id}
                className={`badge-tile ${earned ? 'earned' : 'locked'}`}
                onMouseEnter={() => openNow(b.id)}
                onMouseLeave={closeSoon}
                onClick={() => setOpenBadgeId((cur) => (cur === b.id ? null : b.id))}
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
      </div>

      <CheckinsGallery user={user} claimedMap={claimedMap} navigate={navigate} totalPoints={stats?.totalPoints || 0} />
    </div>
  );
}
