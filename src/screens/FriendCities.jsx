import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUserStats } from '../lib/leaderboard';
import { getUserProfile } from '../lib/friends';
import CityList from '../components/CityList';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError } from '../lib/friendlyError';
import { Skeleton, SkeletonList } from '../components/Skeleton';

// A friend's cities list as its own page, reached from FriendStats' "cities"
// tile -- self-sufficient (fetches its own name/stats) so it survives a
// direct link or a browser refresh, not just in-app navigation.
export default function FriendCities() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const [profile, s] = await Promise.all([getUserProfile(uid), getUserStats(uid)]);
        if (cancelled) return;
        setName(profile?.username ? `@${profile.username}` : 'This user');
        setStats(s);
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
      <h1 className="screen-title">
        <span>{'\u{1F3D9}\u{FE0F}'}</span>{' '}
        {name ? `${name}'s Cities` : error ? 'Cities' : <Skeleton width={180} height={26} radius={10} />}
      </h1>
      {error && (
        <ErrorNotice
          message={friendlyError(error, "We couldn't load their cities. Try again.")}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {!error && !stats && <SkeletonList count={4} label="Loading their cities" />}
      {stats && <CityList cityIds={stats.cityIds} cityPoints={stats.cityPoints} cityLastVisit={stats.cityLastVisit} />}
    </div>
  );
}
