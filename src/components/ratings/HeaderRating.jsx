import { Skeleton } from '../Skeleton';
import { formatReviews, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';

// The rating under a landmark page's title: the Google rating when Google
// has one ("⭐ 3.9 (7,398 reviews) Google Maps"), "No Google rating yet" when
// Google has none. `agg` (the app's own average) is no longer shown. `outside` is
// useLandmarkRatings' result, shared with the Ratings section below so the
// page makes one call.
export default function HeaderRating({ outside }) {
  const google = outside?.status === 'done' && hasRating(outside.sources?.google) ? outside.sources.google : null;
  if (google) {
    return (
      <span className="header-google-rating" data-source="google">
        <span className="ratings-star" aria-hidden="true">
          {'⭐'}
        </span>
        <strong>{google.rating.toFixed(1)}</strong> <span className="ratings-count">({formatReviews(google.count)})</span>{' '}
        <GoogleAttribution />
      </span>
    );
  }
  // Google only (owner, 2026-11-08): the app's own average never shows.
  if (outside?.status === 'loading' || outside?.status === 'idle') return <Skeleton width={140} height={18} />;
  if (outside?.status === 'done' && outside.sources?.googleNoRating) return <span className="header-google-rating ratings-none">No Google rating yet</span>;
  return null;
}
