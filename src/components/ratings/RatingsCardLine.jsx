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
// (no Google listing, or a listing nobody rated) it shows `fallback` (the
// app's own rating tag) or, with none, "No ratings yet. Be the first"; the
// fallback also shows while loading or when the lookup failed. A landmark
// with no stored Google ID is matched by the server on first sight, so
// "no rating" means Google really has none.
// `preloaded`: sources the list already fetched (the Landmarks tab's Top Landmarks
// sort), shown as-is with no second call.
function RatingsCardLine({ landmark, fallback = null, flags = RATINGS_FLAGS, preloaded = null }) {
  const enabled = flags.cardLine;
  const live = useLandmarkRatings(landmark, { enabled: enabled && !preloaded });
  const { ref } = live;
  const status = enabled && preloaded ? 'done' : live.status;
  const sources = enabled && preloaded ? preloaded : live.sources;
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
        // Google has none: the app's own rating, else an invitation to give it.
        fallback || (
          <span className="tag rating-tag ratings-none" data-source="none">
            No ratings yet. Be the first
          </span>
        )
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
