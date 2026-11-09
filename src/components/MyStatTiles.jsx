import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useBadges } from '../lib/BadgesContext';
import { useRatings } from '../lib/RatingsContext';
import { RATING_GOAL } from '../lib/ratingFlow';
import { subscribeMySoloStreak } from '../lib/soloStreaks';
import { displayStreakCount } from '../lib/streaks';
import { Skeleton } from './Skeleton';

// Your four headline numbers: check-ins, cities, streak and how many places
// you have rated. Used at the top of Full Stats (owner, 2026-11-09); each tile
// opens its list, like the tiles on Profile's Your Stats.
export default function MyStatTiles() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { stats } = useBadges();
  const { myReviews } = useRatings();
  const [solo, setSolo] = useState(null);
  const uid = user?.uid;
  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    return subscribeMySoloStreak(uid, setSolo, () => {});
  }, [firebaseEnabled, uid]);
  // Only tier ratings count, the same as Profile's "rated" bar.
  const rated = Object.values(myReviews || {}).filter((r) => r.ratingTier).length;
  const streak = displayStreakCount(solo);
  const num = (v, w = 36) => (stats?.failed ? '–' : stats ? v : <Skeleton className="skeleton-inline" width={w} height={22} />);
  return (
    <div className="profile-stats my-stat-tiles">
      <button type="button" className="profile-stat profile-stat-btn" onClick={() => stats?.checkins && navigate('/checkins')}>
        <span className="profile-stat-num">{num(stats?.checkins?.toLocaleString())}</span>
        <span className="profile-stat-label">check-ins</span>
      </button>
      <button type="button" className="profile-stat profile-stat-btn" onClick={() => stats?.cityIds?.length && navigate('/cities')}>
        <span className="profile-stat-num">{num(stats?.cities, 28)}</span>
        <span className="profile-stat-label">cities</span>
      </button>
      <button type="button" className="profile-stat profile-stat-btn" onClick={() => navigate('/streaks')}>
        <span className="profile-stat-num">
          {streak}
          {streak ? ' \u{1F525}' : ''}
        </span>
        <span className="profile-stat-label">streak</span>
      </button>
      <button type="button" className="profile-stat profile-stat-btn" onClick={() => navigate('/mapr-ratings')}>
        <span className="profile-stat-num">
          {rated}/{RATING_GOAL}
        </span>
        <span className="profile-stat-label">rated</span>
      </button>
    </div>
  );
}
