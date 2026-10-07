import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUserStats } from '../lib/leaderboard';
import { getUserProfile } from '../lib/friends';
import CheckinsGallery from '../components/CheckinsGallery';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError } from '../lib/friendlyError';
import { Skeleton, SkeletonList } from '../components/Skeleton';

// Stable props: CheckinsGallery reloads every check-in when these change identity.
const NO_CLAIMS = {};

// A friend's check-ins gallery as its own page, reached from FriendStats'
// "check-ins" tile -- self-sufficient (fetches its own name/points) so it
// survives a direct link or a browser refresh, not just in-app navigation.
export default function FriendCheckins() {
  const { uid } = useParams();
  const friendUser = useMemo(() => ({ uid }), [uid]);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [totalPoints, setTotalPoints] = useState(0);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Moving to another friend's page reuses this component -- don't keep
    // showing the previous friend's name/points while the new ones load.
    setLoaded(false);
    (async () => {
      try {
        const [profile, stats] = await Promise.all([getUserProfile(uid), getUserStats(uid)]);
        if (cancelled) return;
        setName(profile?.username ? `@${profile.username}` : 'This user');
        setTotalPoints(stats.totalPoints);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => navigate(-1)}>
        {'←'} Back
      </button>
      {error && (
        <ErrorNotice
          message={friendlyError(error, "We couldn't load their check-ins. Try again.")}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {!error && !loaded && (
        <div className="section">
          {/* Same shape as the gallery about to replace it: points card, heading, rows. */}
          <div className="card" style={{ textAlign: 'center', marginBottom: 14 }} aria-hidden="true">
            <Skeleton width="50%" height={28} style={{ margin: '0 auto' }} />
          </div>
          <Skeleton width="55%" height={20} style={{ marginBottom: 12 }} />
          <SkeletonList count={5} label="Loading their check-ins" />
        </div>
      )}
      {loaded && (
        <CheckinsGallery
          user={friendUser}
          claimedMap={NO_CLAIMS}
          navigate={navigate}
          totalPoints={totalPoints}
          title={`${name}'s Check-ins`}
        />
      )}
    </div>
  );
}
