import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useBadges } from '../lib/BadgesContext';
import CheckinsGallery from '../components/CheckinsGallery';

// Just the check-ins gallery, on its own -- Your Stats' "check-ins" tile used
// to send you to Full Stats (level + badges + everything), when what was
// wanted was only the check-ins. "See Full Stats" still goes there.
export default function MyCheckins() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { claimedMap } = useCheckIn();
  const { stats } = useBadges();

  if (!firebaseEnabled || !user) {
    return (
      <div>
        <p className="screen-subtitle">Sign in on Profile to see your check-ins.</p>
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
      <CheckinsGallery user={user} claimedMap={claimedMap} navigate={navigate} totalPoints={stats?.failed ? '–' : stats ? stats.totalPoints || 0 : null} />
    </div>
  );
}
