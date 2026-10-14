import { memo } from 'react';
import { useLandmarkRatings } from '../../lib/useLandmarkRatings';
import { RATINGS_FLAGS, formatCount, formatReviews, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';
import { TripadvisorMark } from './TripadvisorRatingRow';
import { useImageAvailable } from './useImageAvailable';
import { TRIPADVISOR_LOGO } from './brand';

// A landmark card's outside ratings: "⭐ 4.6 (23,757 reviews) Google Maps" (plus
// Tripadvisor when it is on), as tags in the card's meta row. Fetches only
// once the card is near the screen, so a long list costs nothing for rows
// never seen and never waits on it. When Google has no rating for the place
// (no Google listing, or a listing nobody rated) it says "No ratings
// available"; `fallback` (the app's own rating tag) shows only while loading
// or when the lookup failed.
function RatingsCardLine({ landmark, fallback = null, flags = RATINGS_FLAGS }) {
  const enabled = flags.cardLine;
  const { ref, status, sources } = useLandmarkRatings(landmark, { enabled });
  const taLogo = useImageAvailable(enabled ? TRIPADVISOR_LOGO : null);
  if (status === 'off') return fallback;
  const google = status === 'done' && hasRating(sources.google) ? sources.google : null;
  const ta = status === 'done' && hasRating(sources.tripadvisor) && taLogo === 'ok' ? sources.tripadvisor : null;
  return (
    <span ref={ref} className="ratings-inline">
      {google ? (
        <span className="tag rating-tag ratings-chip-google" data-source="google">
          {'⭐'} {google.rating.toFixed(1)} <span className="ratings-count">({formatReviews(google.count)})</span> <GoogleAttribution />
        </span>
      ) : status === 'done' && sources.googleNoRating ? (
        <span className="tag rating-tag ratings-none" data-source="none">
          No ratings available
        </span>
      ) : (
        fallback
      )}
      {ta && (
        <span className="tag ratings-chip-ta" data-source="tripadvisor">
          <TripadvisorMark data={ta} compact />
          <span className="ratings-count">({formatCount(ta.count)})</span>
        </span>
      )}
    </span>
  );
}

export default memo(RatingsCardLine);
