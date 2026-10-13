import { memo } from 'react';
import { useLandmarkRatings } from '../../lib/useLandmarkRatings';
import { RATINGS_FLAGS, formatCount, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';
import { TripadvisorMark } from './TripadvisorRatingRow';
import { useImageAvailable } from './useImageAvailable';
import { TRIPADVISOR_LOGO } from './brand';

// One compact line of outside ratings on a landmark card. Fetches only once
// the card is near the screen, so a long list costs nothing for rows never
// seen and the list itself never waits on it. Hidden when no source has data.
function RatingsCardLine({ landmark, flags = RATINGS_FLAGS }) {
  const enabled = flags.cardLine && !landmark?.custom;
  const { ref, status, sources } = useLandmarkRatings(landmark, { enabled });
  const taLogo = useImageAvailable(enabled ? TRIPADVISOR_LOGO : null);
  if (status === 'off') return null;
  if (status !== 'done') {
    return <span ref={ref} className="ratings-line ratings-line-loading" aria-hidden="true" />;
  }
  const google = hasRating(sources.google) ? sources.google : null;
  const ta = hasRating(sources.tripadvisor) && taLogo === 'ok' ? sources.tripadvisor : null;
  if (!google && !ta) return <span ref={ref} className="ratings-line ratings-line-empty" />;
  return (
    <span ref={ref} className="ratings-line">
      {google && (
        <span className="ratings-chip ratings-chip-google" data-source="google">
          <span className="ratings-star" aria-hidden="true">
            {'★'}
          </span>
          {google.rating.toFixed(1)} <span className="ratings-count">({formatCount(google.count)})</span>{' '}
          <GoogleAttribution />
        </span>
      )}
      {ta && (
        <span className="ratings-chip ratings-chip-ta" data-source="tripadvisor">
          <TripadvisorMark data={ta} compact />
          <span className="ratings-count">({formatCount(ta.count)})</span>
        </span>
      )}
    </span>
  );
}

export default memo(RatingsCardLine);
