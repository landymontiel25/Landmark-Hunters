import RatingStars from '../RatingStars';
import { Skeleton } from '../Skeleton';
import { formatCount, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';

// The rating under a landmark page's title: the Google rating when Google
// has one ("⭐ 3.9 (7,398) Google Maps"), otherwise the app's own users'
// average (RatingStars, "No ratings yet" when there is none). `outside` is
// useLandmarkRatings' result, shared with the Ratings section below so the
// page makes one call.
export default function HeaderRating({ outside, agg }) {
  const google = outside?.status === 'done' && hasRating(outside.sources?.google) ? outside.sources.google : null;
  if (google) {
    return (
      <span className="header-google-rating" data-source="google">
        <span className="ratings-star" aria-hidden="true">
          {'⭐'}
        </span>
        <strong>{google.rating.toFixed(1)}</strong> <span className="ratings-count">({formatCount(google.count)})</span>{' '}
        <GoogleAttribution />
      </span>
    );
  }
  // Still loading and nothing of our own to show: a quiet placeholder rather
  // than "No ratings yet" that a second later turns into a Google rating.
  if (outside?.status === 'loading' && !agg?.count) return <Skeleton width={140} height={18} />;
  return <RatingStars value={agg?.avg || 0} count={agg?.count || 0} size="1.15rem" />;
}
