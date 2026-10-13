import { useLandmarkRatings } from '../../lib/useLandmarkRatings';
import { formatCount, hasRating } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';

// The Google rating in a Map tab pin popup ("⭐ 3.9 (7,398) Google Maps").
// Only rendered while the map itself is Google's: Google forbids its Places
// ratings on a non-Google map, so offline (Esri/Carto) it is not mounted.
// A popup's content only mounts when it opens, so this is one call per open.
export default function MapPopupRating({ landmark }) {
  const { status, sources } = useLandmarkRatings(landmark, { lazy: false, enabled: !landmark?.custom });
  const google = status === 'done' && hasRating(sources?.google) ? sources.google : null;
  if (!google) return null;
  return (
    <p className="map-popup-rating" data-source="google">
      {'⭐'} <strong>{google.rating.toFixed(1)}</strong> <span className="ratings-count">({formatCount(google.count)})</span>{' '}
      <GoogleAttribution />
    </p>
  );
}
