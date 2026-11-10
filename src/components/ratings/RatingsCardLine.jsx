import { memo } from 'react';
import { useLandmarkRatings } from '../../lib/useLandmarkRatings';
import { RATINGS_FLAGS, formatReviews, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';

// A landmark card's outside ratings: "⭐ 4.6 (23,757 reviews) Google Maps" as tags in the card's meta row. Fetches only
// once the card is near the screen, so a long list costs nothing for rows
// never seen and never waits on it. When Google has no rating for the place
// (no Google listing, or a listing nobody rated) it shows `fallback` (the
// app's own rating tag) or, with none, "No ratings yet. Be the first"; the
// fallback also shows while loading or when the lookup failed. A landmark
// with no stored Google ID is matched by the server on first sight, so
// "no rating" means Google really has none.
// `fetchOwn: false` (the Landmarks list): the card never looks itself up, it
// only shows what the list preloaded for the current and next page.
// `preloaded`: sources the list already fetched (the Landmarks tab's Top Landmarks
// sort), shown as-is with no second call.
function RatingsCardLine({ landmark, fallback = null, flags = RATINGS_FLAGS, preloaded = null, fetchOwn = true }) {
  const enabled = flags.cardLine;
  const live = useLandmarkRatings(landmark, { enabled: enabled && !preloaded && fetchOwn });
  const { ref } = live;
  const status = enabled && preloaded ? 'done' : live.status;
  const sources = enabled && preloaded ? preloaded : live.sources;
  if (status === 'off') return fallback;
  const google = status === 'done' && hasRating(sources.google) ? sources.google : null;
  return (
    <span ref={ref} className="ratings-inline">
      {google ? (
        <span className="tag rating-tag ratings-chip-google" data-source="google">
          {'⭐'} {google.rating.toFixed(1)} <span className="ratings-count">({formatReviews(google.count)})</span> <GoogleAttribution />
        </span>
      ) : status === 'done' && sources.googleNoRating ? (
        // Google has none. The app's own ratings never show (owner, 2026-11-08).
        <span className="tag rating-tag ratings-none" data-source="none">
          No Google rating yet
        </span>
      ) : (
        fallback
      )}
    </span>
  );
}

export default memo(RatingsCardLine);
