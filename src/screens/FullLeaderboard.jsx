import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { subscribeLeaderboard, cleanName, rankOf } from '../lib/leaderboard';
import FriendPopoverName from '../components/FriendPopoverName';
import { SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError } from '../lib/friendlyError';
import { readPersisted, writePersisted } from '../lib/usePersistentState';

const PERIOD_LABEL = { weekly: 'This Week', monthly: 'This Month', yearly: 'This Year' };
// Shared with Profile's period tabs, so "This Month" stays picked across
// both screens and across visits.
const PERIOD_KEY = 'leaderboard.period';
// subscribeLeaderboard has no error callback -- a listener that never
// delivers a first snapshot is how a failed read shows up here.
const STALL_MS = 15000;
const TABS = [
  { id: 'weekly', label: 'This Week' },
  { id: 'monthly', label: 'This Month' },
  { id: 'yearly', label: 'This Year' },
];

// A dedicated page (not a modal) for the complete ranked list -- reachable
// via "See Full List" next to the Leaderboard heading on Profile, and
// bookmarkable/shareable on its own since the period is a query param.
export default function FullLeaderboard() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPeriod = (p) => TABS.some((t) => t.id === p);
  const saved = readPersisted(PERIOD_KEY);
  const period = isPeriod(searchParams.get('period'))
    ? searchParams.get('period')
    : isPeriod(saved)
    ? saved
    : 'weekly';
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!firebaseEnabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    let arrived = false;
    const stall = setTimeout(() => {
      if (!arrived) {
        setLoadFailed(true);
        setLoading(false);
      }
    }, STALL_MS);
    let unsub = () => {};
    try {
      unsub = subscribeLeaderboard(period, (data) => {
        arrived = true;
        clearTimeout(stall);
        setEntries(data);
        setLoadFailed(false);
        setLoading(false);
      }, 200, () => {
        arrived = true;
        clearTimeout(stall);
        setLoadFailed(true);
        setLoading(false);
      });
    } catch {
      clearTimeout(stall);
      setLoadFailed(true);
      setLoading(false);
    }
    return () => {
      clearTimeout(stall);
      unsub();
    };
  }, [period, firebaseEnabled, attempt]);

  const pickPeriod = (id) => {
    writePersisted(PERIOD_KEY, id);
    setSearchParams({ period: id });
  };

  const displayFor = (e) => (user && e.userId === user.uid && myUsername ? myUsername : cleanName(e.userName));

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>

      <h1 className="screen-title">
        <span>{'\u{1F3C6}'}</span> Full Leaderboard
      </h1>

      <div className="tabs" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${period === t.id ? 'active' : ''}`} aria-pressed={!!(period === t.id)}
            onClick={() => pickPeriod(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!firebaseEnabled && (
        <div className="empty-state">
          <p>Leaderboards aren't configured yet.</p>
        </div>
      )}

      {firebaseEnabled && loading && <SkeletonList count={8} variant="rank" label="Loading rankings" />}

      {firebaseEnabled && !loading && loadFailed && (
        <ErrorNotice
          message={friendlyError(null, "We couldn't load the rankings. Check your connection and try again.")}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}

      {firebaseEnabled && !loading && !loadFailed && entries.length === 0 && (
        <div className="empty-state">
          <p>No points yet {PERIOD_LABEL[period].toLowerCase()} — check in to be first!</p>
        </div>
      )}

      {firebaseEnabled &&
        !loading &&
        !loadFailed &&
        entries.map((e, idx) => (
          <div key={e.id} className={`leaderboard-row ${user && e.userId === user.uid ? 'me' : ''}`}>
            <div className="leaderboard-rank">#{rankOf(entries, idx)}</div>
            <div style={{ flex: 1 }}>
              <FriendPopoverName userId={e.userId} fallbackName={displayFor(e)}>
                {displayFor(e)}
              </FriendPopoverName>
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-brass-bright)', fontWeight: 700 }}>
              {e.points.toLocaleString()} pts
            </div>
          </div>
        ))}
    </div>
  );
}
