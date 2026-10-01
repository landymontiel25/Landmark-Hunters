import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useBadges } from '../lib/BadgesContext';
import CityList from '../components/CityList';
import { SkeletonList } from '../components/Skeleton';

// Just the cities list, on its own -- Your Stats' "cities" tile used to open
// a modal; this is a real page instead, matching "check-ins" and the friend
// equivalent. "See Full Stats" still shows level + badges + everything.
export default function MyCities() {
  const navigate = useNavigate();
  const { user, loading: authLoading, firebaseEnabled } = useAuth();
  const { stats } = useBadges();

  if (authLoading) return <SkeletonList count={4} label="Loading your cities" />;

  if (!firebaseEnabled || !user) {
    return (
      <div>
        <p className="screen-subtitle">Sign in on Profile to see your cities.</p>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
          {'←'} Back to Profile
        </button>
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => navigate('/profile')}>
        {'←'} Back to Profile
      </button>
      <h1 className="screen-title">
        <span>{'\u{1F3D9}\u{FE0F}'}</span> Cities you've visited
      </h1>
      {/* stats is null until BadgesContext's first read lands -- an empty
          CityList there would read as "no cities yet". */}
      {stats ? (
        <CityList cityIds={stats.cityIds} cityPoints={stats.cityPoints} cityLastVisit={stats.cityLastVisit} />
      ) : (
        <SkeletonList count={4} label="Loading your cities" />
      )}
    </div>
  );
}
