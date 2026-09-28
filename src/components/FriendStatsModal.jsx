import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserStats, getUserCheckins, isRealCheckin } from '../lib/leaderboard';
import { getRegion } from '../data/regions';
import { friendlyError } from '../lib/friendlyError';
import { usePairStreaks } from '../lib/PairStreakContext';
import { Skeleton } from './Skeleton';
import ErrorNotice from './ErrorNotice';

// Starting a streak lives on the streak icon itself now (Header's flame,
// or Your Stats' "streak" tile -> MyStreaks), not here -- streak-first,
// friend-second. This modal only shows whether one already exists with
// this friend, as context, same as everything else on it.

// A friend's quick summary -- points/check-ins/cities/last check-in -- as a
// popup modal. Check-ins and Cities are buttons that navigate to their own
// real pages rather than opening a second overlay on top of this one, which
// looked wrong on iOS Safari. Shared by every place a friend's name shows up
// (the Friends list, leaderboard rows, wherever) so tapping a friend always
// gets you here the same way.
export default function FriendStatsModal({ uid, name, onClose }) {
  const navigate = useNavigate();
  const { streaks } = usePairStreaks();
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const existingStreak = streaks.find((s) => (s.memberIds || []).includes(uid));

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    Promise.all([getUserStats(uid), getUserCheckins(uid)])
      .then(([stats, checkins]) => {
        // A "Rate a Landmark" claim isn't a visit -- skip it for
        // "most recent check-in", same as the check-ins gallery does.
        const recent = checkins.find(isRealCheckin) || null;
        if (!cancelled) setState({ loading: false, stats, recent });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          {'\u{1F464}'} @{name}
        </h3>
        {state.loading && (
          // Same three tiles + "last check-in" line that are about to appear.
          <div role="status" aria-live="polite">
            <span className="visually-hidden">Loading their stats…</span>
            <div className="profile-stats" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="profile-stat">
                  <Skeleton width={40} height={22} style={{ margin: '0 auto 6px' }} />
                  <Skeleton width={56} height={10} style={{ margin: '0 auto' }} />
                </div>
              ))}
            </div>
            <Skeleton width="70%" height={12} style={{ marginTop: 14 }} />
          </div>
        )}
        {state.error && (
          <ErrorNotice
            compact
            message={friendlyError(state.error, "We couldn't load their stats. Try again.")}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
        {state.stats && (
          <>
            <div className="profile-stats">
              <div className="profile-stat">
                <span className="profile-stat-num">{state.stats.totalPoints.toLocaleString()}</span>
                <span className="profile-stat-label">total pts</span>
              </div>
              <button
                type="button"
                className="profile-stat profile-stat-btn"
                onClick={() => state.stats.checkins && navigate(`/friend/${uid}/checkins`)}
              >
                <span className="profile-stat-num">{state.stats.checkins.toLocaleString()}</span>
                <span className="profile-stat-label">check-ins{state.stats.checkins ? ' ›' : ''}</span>
              </button>
              <button
                type="button"
                className="profile-stat profile-stat-btn"
                onClick={() => state.stats.cities && navigate(`/friend/${uid}/cities`)}
              >
                <span className="profile-stat-num">{state.stats.cities}</span>
                <span className="profile-stat-label">cities{state.stats.cities ? ' ›' : ''}</span>
              </button>
            </div>
            {state.recent ? (
              <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 0 }}>
                Last check-in: <strong>{state.recent.landmarkName || 'a landmark'}</strong>
                {state.recent.region ? ` — ${getRegion(state.recent.region)?.name || ''}` : ''}
              </p>
            ) : (
              <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 0 }}>
                No check-ins yet.
              </p>
            )}
          </>
        )}
        {existingStreak && (
          <p className="screen-subtitle" style={{ marginTop: 16, marginBottom: 0 }}>
            {'\u{1F525}'} You have a {existingStreak.count}-day streak with @{name}.
          </p>
        )}
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
