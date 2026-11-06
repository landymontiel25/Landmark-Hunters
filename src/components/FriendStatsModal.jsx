import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserStats, getUserCheckins, isRealCheckin } from '../lib/leaderboard';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { friendlyError } from '../lib/friendlyError';
import { Skeleton } from './Skeleton';
import ErrorNotice from './ErrorNotice';

// A friend's quick summary as a narrow popup (owner, 2026-11-06 layout):
// @username and points on one line, then their three most recent check-ins
// (name and date) with "See all", then "See full profile" above "Close".
// Plain rows, no stat cards. Check-ins ("See all") and Cities open their own
// pages rather than a second overlay on top of this one, which looked wrong
// on iOS Safari. Shared by every place a friend's name shows up (the Friends
// list, leaderboard rows, wherever) so tapping a friend always gets you here
// the same way.
const RECENT_ROWS = 3;
const shortDate = (c) => (c?.createdAt?.seconds ? new Date(c.createdAt.seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2013');

export default function FriendStatsModal({ uid, name, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { friendUids } = useFriends();
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  // The full profile is for friends only (it shows their rank among yours).
  const canOpenProfile = friendUids.has(uid) && user?.uid !== uid;

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    Promise.all([getUserStats(uid), getUserCheckins(uid)])
      .then(([stats, checkins]) => {
        // A "Rate a Landmark" claim isn't a visit -- skip it for
        // "most recent check-in", same as the check-ins gallery does.
        const recent = checkins.filter(isRealCheckin).slice(0, RECENT_ROWS);
        if (!cancelled) setState({ loading: false, stats, recent });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  const openCheckins = () => state.stats?.checkins && navigate(`/friend/${uid}/checkins`);
  const openCities = () => state.stats?.cities && navigate(`/friend/${uid}/cities`);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card friend-popup" role="dialog" aria-label={`@${name}`} onClick={(e) => e.stopPropagation()}>
        <div className="fpop-top">
          <span className="fpop-name">@{name}</span>
          <span className="fpop-points">
            {state.stats ? `${state.stats.totalPoints.toLocaleString()} pts` : state.loading ? <Skeleton width={64} height={14} /> : '\u2013 pts'}
          </span>
        </div>

        <div className="fpop-label-row">
          <span className="fpop-label">Check-ins</span>
          {state.stats?.cities > 0 && (
            <button type="button" className="fpop-link" onClick={openCities}>
              {state.stats.cities} {state.stats.cities === 1 ? 'city' : 'cities'} {'\u203A'}
            </button>
          )}
        </div>

        {state.loading && (
          <div role="status" aria-live="polite">
            <span className="visually-hidden">Loading their check-ins…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="fpop-row" aria-hidden="true">
                <Skeleton width="60%" height={12} />
                <Skeleton width={70} height={12} />
              </div>
            ))}
          </div>
        )}
        {state.error?.code === 'permission-denied' && (
          <p className="fpop-note">You can't see these check-ins. Check-ins show to friends, or to everyone when the profile is public.</p>
        )}
        {state.error && state.error.code !== 'permission-denied' && (
          <ErrorNotice compact message={friendlyError(state.error, "We couldn't load their stats. Try again.")} onRetry={() => setAttempt((n) => n + 1)} />
        )}
        {state.stats && (
          <>
            {state.recent.length === 0 && <p className="fpop-note">No check-ins yet.</p>}
            {state.recent.map((c) => (
              <div key={c.id} className="fpop-row">
                <span className="fpop-row-name">{c.landmarkName || 'A landmark'}</span>
                <span className="fpop-row-date">{shortDate(c)}</span>
              </div>
            ))}
            {state.stats.checkins > 0 && (
              <button type="button" className="fpop-link fpop-see-all" onClick={openCheckins}>
                See all {'\u203A'}
              </button>
            )}
          </>
        )}

        <div className="fpop-actions">
          {canOpenProfile && (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                onClose?.();
                navigate(`/friend/${uid}`);
              }}
            >
              See full profile
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
