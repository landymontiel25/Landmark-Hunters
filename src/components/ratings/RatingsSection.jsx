import { useLandmarkRatings } from '../../lib/useLandmarkRatings';
import { RATINGS_FLAGS, hasRating } from '../../lib/ratingSources';
import { Skeleton } from '../Skeleton';
import GoogleRatingRow from './GoogleRatingRow';
import TripadvisorRatingRow from './TripadvisorRatingRow';
import LandmarkHuntersRatingRow from './LandmarkHuntersRatingRow';
import { useImageAvailable } from './useImageAvailable';
import { TRIPADVISOR_LOGO } from './brand';

// The detail screen's "Ratings" section: one row per source with data, each
// in its own bordered box (Google requires its content set apart from other
// sources'). A source with no data hides its row; no rows hides the section.
// `lhAgg` is the app's own { avg, count }, used only when the Landmark
// Hunters flag is on.
export default function RatingsSection({ landmark, lhAgg = null, flags = RATINGS_FLAGS }) {
  const { status, sources } = useLandmarkRatings(landmark, { detail: true, lazy: false });
  const taLogo = useImageAvailable(TRIPADVISOR_LOGO);
  const lh = flags.landmarkHunters && lhAgg?.count > 0;

  if (status === 'off') return null;
  if (status !== 'done') {
    return (
      <div className="card section ratings-section" aria-busy="true">
        <h3>Ratings</h3>
        <span className="visually-hidden" role="status">
          Loading ratings
        </span>
        <Skeleton height={18} width="70%" />
        <Skeleton height={18} width="55%" style={{ marginTop: 10 }} />
      </div>
    );
  }
  const google = hasRating(sources.google) ? sources.google : null;
  const ta = hasRating(sources.tripadvisor) && taLogo === 'ok' ? sources.tripadvisor : null;
  if (!google && !ta && !lh) return null;
  return (
    <div className="card section ratings-section">
      <h3>Ratings</h3>
      {google && <GoogleRatingRow data={google} />}
      {ta && <TripadvisorRatingRow data={ta} />}
      {lh && <LandmarkHuntersRatingRow agg={lhAgg} />}
    </div>
  );
}
